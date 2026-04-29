import { MongoClient, type Db } from "mongodb";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getDb(): Promise<Db> {
  if (cachedDb) return cachedDb;
  const uri = process.env["MONGODB_URI"];
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  const client = new MongoClient(uri);
  await client.connect();
  cachedClient = client;
  cachedDb = client.db("apnaapp");
  return cachedDb;
}

export type UserDoc = {
  phone: string;
  createdAt: string;
  updatedAt: string;
  aadhar?: AadharDoc | null;
};

export type AadharDoc = {
  name?: string | null;
  aadhaarNumber?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  mobileNumber?: string | null;
  photoBase64?: string | null;
  photoMimeType?: string | null;
  rawText?: string | null;
};

export async function upsertUserDoc(phone: string): Promise<UserDoc> {
  const db = await getDb();
  const users = db.collection<UserDoc>("users");
  const now = new Date().toISOString();
  await users.updateOne(
    { phone },
    {
      $setOnInsert: { phone, createdAt: now, aadhar: null },
      $set: { updatedAt: now },
    },
    { upsert: true },
  );
  const doc = await users.findOne({ phone });
  return doc as UserDoc;
}

export async function getUserDoc(phone: string): Promise<UserDoc | null> {
  const db = await getDb();
  const users = db.collection<UserDoc>("users");
  return (await users.findOne({ phone })) as UserDoc | null;
}

export async function setAadharOnUser(
  phone: string,
  aadhar: AadharDoc,
): Promise<UserDoc> {
  const db = await getDb();
  const users = db.collection<UserDoc>("users");
  const now = new Date().toISOString();
  await users.updateOne(
    { phone },
    {
      $setOnInsert: { phone, createdAt: now },
      $set: { aadhar, updatedAt: now },
    },
    { upsert: true },
  );
  const doc = await users.findOne({ phone });
  return doc as UserDoc;
}

export async function closeMongo(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
}
