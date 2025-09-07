import express from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import dbconnect from '../dbconnect.js';
import bcrypt from 'bcrypt';
import transporter from '../utils/mail.js';

dotenv.config();
const router = express.Router();

router.post('/', async (req, res) => {
    try {
        const { emailid, password } = req.body;
        const connect = await dbconnect();
        const user = await connect.db('login').collection('traderlogin').findOne({ emailid: emailid });
        if (!user) {
            res.status(400).send({ message: "User not found", success: false })
            return
        }
        const check = await bcrypt.compare(password, user.password);
        if (check) {
            if (user.isLogging) {
                return res.send({ message: "User already Login", success: false });
            }
            const islog = await connect.db('login').collection('traderlogin').updateOne({ emailid: emailid }, { $set: { isLogging: true } });
            if (islog.acknowledged) {
                const token = jwt.sign({ emailid: user.emailid }, process.env.USER_TOKEN, { expiresIn: '1d' });
                setTimeout(async () => {
                    await connect.db('login').collection('traderlogin').updateOne({ emailid: emailid }, { $set: { isLogging: false } });
                }, 86400 * 1000)
                return res.send({ message: "Login Successfully", token, success: true });
            }
            else {
                return res.send({ message: "Failed to login", success: false });
            }

        }
        return res.send({ message: "Invalid Password", success: false });

    } catch (err) {
        res.status(500).send({ message: "Error" });
    }
})
router.get('/logout/:emailid', async (req, res) => {
    try {
        const { emailid } = req.params;
        if(!emailid){
            return res.status(500).send({ message: "Error", success: false })
        }
        const connect = await dbconnect();
        const islog = await connect.db('login').collection('traderlogin').updateOne({ emailid: emailid }, { $set: { isLogging: false } });
        if (islog.acknowledged) {
            return res.send({ message: "Logout successfully", success: true });
        }
        return res.status(500).send({ message: "Failed to Logout", success: false });
    } catch (err) {
        return res.status(500).send({ message: "Error", success: false })
    }
})
router.post('/CheckCode', async (req, res) => {
    try {
        const data = req.body;
        const database = await dbconnect();
        const currentData = await database.db('login').collection('traderlogin').findOne({ emailid: data.emailid })
        if (currentData.code === data.code) {
            data.newPassword = await bcrypt.hash(data.newPassword, 10);
            const updatePassword = await database.db('login').collection('traderlogin').updateOne({ emailid: data.emailid }, { $set: { password: data.newPassword } });
            if (updatePassword.acknowledged && updatePassword.matchedCount > 0) {
                const update = await database.db('login').collection('traderlogin').updateOne({ emailid: data.emailid }, { $set: { code: "" } })
                res.json({ success: true, message: "Password reset successfully" });
            }
            else {
                res.json({ success: false, message: "Unable to reset password" })
            }
        }
        else {
            res.send({ success: false, message: "Wrong Verification code" });
        }
    } catch (err) {
        res.status(500).send({ success: false, message: "Error" })
    }
})
router.post('/forgotPassword', async (req, res) => {
    try {
        const database = await dbconnect();
        const random = Math.floor(100000 + Math.random() * 900000);
        const email = req.body;
        const update = await database.db('login').collection('traderlogin').updateOne(email, { $set: { code: random } })
        if (update.acknowledged && update.matchedCount > 0) {
            const mail = {
                from: process.env.USER_NAME,
                to: email.emailid,
                subject: "Forgot Password",
                template: "CodeSend",
                context: {
                    random: String(random)
                }
            }
            transporter.sendMail(mail, (err, info) => {
                if (err) {
                    console.log(err);
                }
                else {
                    console.log("Send Successfully")
                }
            })
            res.send({ success: true })

            setTimeout(async () => {
                await database.db('login').collection('traderlogin').updateOne(email, { $set: { code: "" } })
                console.log("verification code expired");

            }, 60 * 10 * 1000);
        }
        else {
            res.send({ success: false });
        }

    } catch (err) {
        res.status(500).send(err);
    }
})

export default router;