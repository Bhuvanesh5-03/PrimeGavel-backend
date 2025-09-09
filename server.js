import express from 'express';
import dotenv from 'dotenv';
import trader from './Router/trader.js';
import transporter from './utils/mail.js';
import bcrypt from 'bcrypt';
import dbconnect from './dbconnect.js';
import cors from 'cors';
import verifyToken from './Middleware/verifyToken.js';
import http from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://primegavel-frontend-1.onrender.com' }));
app.use('/traderLogin', trader);

const date = new Date();
const currentDate = date.toISOString().split("T")[0];

app.get('/verifyToken', verifyToken, (req, res) => {
  res.json({ success: true, user: req.userData });
});

app.post('/traderSignup', async (req, res) => {
  try {
    const data = req.body;
    data.password = await bcrypt.hash(data.password, 10);
    const connect = await dbconnect();
    const db = await connect.db('login');
    data.code = "";
    data.isLogging = false;
    data.pastAuction = []; 
    const user = await db.collection('traderlogin').findOne({ emailid: data.emailid });
    if (user) {
      return res.status(400).send({ message: "User already exists", success: false });
    }
    const insert = await db.collection('traderlogin').insertOne(data);
    if (insert.acknowledged) {
      res.send({ message: "SignUp Successfully", success: true });
      return;
    }
    return res.status(500).send({ message: "failed to insert", success: false });
  } catch (err) {
    res.status(500).send({ message: "Error" });
  }
});

app.post('/auctionDetail', async (req, res) => {
  try {
    const data = req.body;
    const database = await dbconnect();
    const process = await database
      .db('Auction')
      .collection('AuctionDetail')
      .updateOne(
        { auction_date: currentDate },
        {
          $setOnInsert: { auction_date: currentDate },
          $push: { items: data }
        },
        { upsert: true }
      );
    res.json({ success: process.acknowledged });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/Count', async (req, res) => {
  try {
    const database = await dbconnect();
    const result = await database.db('Auction').collection("AuctionDetail").aggregate([
      { $match: { auction_date: currentDate } },
      { $project: { count: { $size: "$items" } } }
    ]).toArray();
    const count = result.length > 0 ? result[0].count : 0;
    res.send({ count: count + 1 });
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post('/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }
    const connect = await dbconnect();
    await connect.db('Auction').collection('ContactMessages').insertOne({
      name,
      email,
      message,
      date: new Date(),
    });

    const mail = {
      from: process.env.USER_NAME,
      to: process.env.USER_NAME,
      subject: "📩 New Contact Form Message - PrimeGavel",
      template: "contact",
      context: { name, email, message }
    };

    transporter.sendMail(mail, (err) => {
      if (err) {
        console.log("❌ Mail error:", err);
      } else {
        console.log("📩 Contact message email sent successfully");
      }
    });

    res.json({ success: true, message: "Message received successfully" });
  } catch (err) {
    console.error("❌ Server Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get('/AuctionPage', verifyToken, async (req, res) => {
  try {
    const database = await dbconnect();
    const auctionData = await database
      .db('Auction')
      .collection("AuctionDetail")
      .findOne({ auction_date: currentDate });

    if (auctionData) {
      const mappedItems = auctionData.items
        .filter(item => !item.Winner)
        .map(item => ({
          lotNumber: `lot-${item.LotNo}`,
          productName: item.ProductName,
          quantity: item.ProductQuantity,
          startingPrice: item.BasePrice,
          consignorName: item.ConsignorName,
          productType: item.ProductType,
          image: item.Image,
          winner: item.Winner
        }));
      if (mappedItems.length === 0) {
        return res.json({ success: false, noAuction: true, message: "No available auctions (all items already have winners)" });
      }
      res.json({ success: true, info: mappedItems, userid: req.userData });
    } else {
      res.json({ success: false, noAuction: true, message: "No auction allocated for today" });
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post('/Winners', verifyToken, async (req, res) => {
  try {
    const userEmail = req.body.emailid || req.userData?.emailid;
    if (!userEmail) {
      return res.status(400).json({ success: false, message: "Email not provided" });
    }
    const database = await dbconnect();
    const user = await database.db('login').collection('traderlogin').findOne({ emailid: userEmail });
    if (user) {
      const pastAuction = Array.isArray(user.pastAuction) ? user.pastAuction : [];
      console.log("Past Winnings:", pastAuction);
      res.json({ success: true, pastAuction });
    } else {
      res.json({ success: false, pastAuction: [], message: "No past auctions found for this user" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/TodayAuction', verifyToken, async (req, res) => {
  try {
    const database = await dbconnect();
    const auctionData = await database
      .db('Auction')
      .collection("AuctionDetail")
      .findOne({ auction_date: currentDate });

    if (auctionData) {
      res.json({ success: true, data: auctionData.items || [] });
    } else {
      res.json({ success: false, message: "No auction data for today" });
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] },
});

const auctions = new Map();
const auctionParticipants = new Map(); // Store auctionId -> Set of trader names
const DEFAULT_TIMER = 10;

io.on("connection", (socket) => {
  console.log(`⚡ User connected: ${socket.id}`);

  socket.on("auction:join", async ({ auctionId, name }) => {
    socket.join(auctionId);

    if (!auctionParticipants.has(auctionId)) {
      auctionParticipants.set(auctionId, new Set());
    }
    const participants = auctionParticipants.get(auctionId);
    participants.add(name);

    io.to(auctionId).emit("auction:participants", { count: participants.size });

    if (!auctions.has(auctionId) && participants.size >= 2) {
      try {
        const database = await dbconnect();
        const auctionData = await database
          .db('Auction')
          .collection("AuctionDetail")
          .findOne({ auction_date: currentDate });

        if (auctionData) {
          const items = auctionData.items
            .filter(item => !item.Winner)
            .map(item => ({
              lotNumber: `lot-${item.LotNo}`,
              productName: item.ProductName,
              quantity: item.ProductQuantity,
              startingPrice: item.BasePrice,
              consignorName: item.ConsignorName,
              productType: item.ProductType,
              image: item.Image,
              winner: item.Winner
            }));

          const item = items.find(i => i.lotNumber === auctionId);
          if (item) {
            auctions.set(auctionId, {
              currentBid: item.startingPrice || 100,
              timer: DEFAULT_TIMER,
              highestBidder: null,
              ended: false,
              interval: setInterval(() => tick(auctionId), 1000)
            });
            console.log(`🚀 Auction ${auctionId} started with ${participants.size} participants.`);
          } else {
            socket.emit("auction:error", { message: "Auction ID not found or already has a winner" });
            return;
          }
        } else {
          socket.emit("auction:error", { message: "No auctions found for today" });
          return;
        }
      } catch (err) {
        socket.emit("auction:error", { message: "Error loading auction" });
        console.error(err);
        return;
      }
    }
  });

  socket.on("auction:bid", ({ auctionId, bidder, increment }) => {
    if (!auctions.has(auctionId)) return;
    const state = auctions.get(auctionId);
    if (state.ended) {
      socket.emit("auction:error", { message: "Auction has ended" });
      return;
    }
    const newBid = state.currentBid + increment;
    if (newBid > state.currentBid) {
      state.currentBid = newBid;
      state.highestBidder = bidder;
      state.timer = DEFAULT_TIMER;
      io.to(auctionId).emit("auction:update", {
        timeLeft: state.timer,
        currentBid: state.currentBid,
        highestBidder: state.highestBidder,
        increment: increment,
        ended: state.ended
      });
      console.log(`💰 ${bidder} placed new bid on ${auctionId}: Rs.${state.currentBid}`);
    } else {
      socket.emit("auction:error", { message: "Your bid must be higher than current amount" });
    }
  });

  socket.on("disconnecting", () => {
    const rooms = socket.rooms;
    rooms.forEach((room) => {
      if (auctionParticipants.has(room)) {
        const participants = auctionParticipants.get(room);
        participants.delete(socket.id);
        io.to(room).emit("auction:participants", { count: participants.size });
      }
    });
  });

  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);
  });
});

async function tick(auctionId) {
  const state = auctions.get(auctionId);
  if (!state) return;

  if (state.timer > 0) {
    state.timer -= 1;
    io.to(auctionId).emit("auction:state", {
      timeLeft: state.timer,
      currentBid: state.currentBid,
      highestBidder: state.highestBidder,
      increment: 2,
      ended: state.ended
    });
  } else {
    state.ended = true;
    clearInterval(state.interval);
    io.to(auctionId).emit("auction:end", {
      timeLeft: 0,
      currentBid: state.currentBid,
      highestBidder: state.highestBidder
    });
    console.log(`🏆 Auction ${auctionId} ended! Winner: ${state.highestBidder} with Rs.${state.currentBid}`);

    try {
      const database = await dbconnect();
      const lotNo = parseInt(auctionId.replace('lot-', ''));
      await database
        .db('Auction')
        .collection("AuctionDetail")
        .updateOne(
          { auction_date: currentDate, "items.LotNo": lotNo },
          {
            $set: {
              "items.$.Winner": state.highestBidder,
              "items.$.finalBid": state.currentBid
            }
          }
        );
      console.log(`Saved winner for ${auctionId} to DB`);

      if (state.highestBidder) {
        const auctionData = await database
          .db('Auction')
          .collection("AuctionDetail")
          .findOne({ auction_date: currentDate });
        if (auctionData) {
          const item = auctionData.items.find(i => i.LotNo === lotNo);
          if (item) {
            const auctionResult = {
              lotNumber: auctionId,
              productName: item.ProductName,
              quantity: item.ProductQuantity,
              basePrice: item.BasePrice,
              finalBid: state.currentBid,
              consignorName: item.ConsignorName,
              productType: item.ProductType,
              auctionDate: currentDate
            };

            await database
              .db('login')
              .collection('traderlogin')
              .updateOne(
                { emailid: state.highestBidder },
                { $push: { pastAuction: auctionResult } }
              );
            console.log(`Updated pastAuction for trader ${state.highestBidder}`);

            const mail = {
              from: process.env.USER_NAME,
              to: state.highestBidder,
              subject: "Congratulations! You Won the Auction",
              text: `Dear Trader,\n\nCongratulations! You have won the auction for ${item.ProductName} (Lot: ${auctionId}) with a final bid of Rs. ${state.currentBid}.\n\nThank you for participating!\n\nBest regards,\nPrimeGavel Team`
            };
            transporter.sendMail(mail, (err) => {
              if (err) console.log(`Error sending win email: ${err}`);
              else console.log(`Win email sent to ${state.highestBidder}`);
            });
          }
        }
      }
    } catch (err) {
      console.error(`Error saving winner or updating pastAuction for ${auctionId}:`, err);
    }
  }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Auction socket server running on http://localhost:${PORT}`);
});
