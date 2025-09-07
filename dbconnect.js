import { MongoClient } from 'mongodb';
import dotenv from 'dotenv'
dotenv.config()

const url = process.env.MONGODB;
const client = new MongoClient(url);

export default async function dbconnect() {
  if (!client.topology || !client.topology.isConnected()) {
    await client.connect();
  }
  return client;
}
