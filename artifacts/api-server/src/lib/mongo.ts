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

// ---------------------------------------------------------------------------
// Legacy `users` collection (kept for the old /api/users + /api/ocr routes)
// ---------------------------------------------------------------------------

export type UserDoc = {
  phone: string;
  createdAt: string;
  updatedAt: string;
  aadhar?: AadharDoc | null;
  passbook?: PassbookDoc | null;
};

export type AadharDoc = {
  name?: string | null;
  aadhaarNumber?: string | null;
  vid?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  fathersOrHusbandsName?: string | null;
  address?: string | null;
  pincode?: string | null;
  state?: string | null;
  mobileNumber?: string | null;
  issueDate?: string | null;
  enrolmentNumber?: string | null;
  photoBase64?: string | null;
  photoMimeType?: string | null;
  rawText?: string | null;
};

export type PassbookTransaction = {
  date?: string | null;
  particulars?: string | null;
  withdrawal?: string | null;
  deposit?: string | null;
  balance?: string | null;
};

export type PassbookDoc = {
  bankName?: string | null;
  accountHolderName?: string | null;
  cifNumber?: string | null;
  accountNumber?: string | null;
  accountType?: string | null;
  ifsc?: string | null;
  micr?: string | null;
  branchName?: string | null;
  branchCode?: string | null;
  accountOpeningDate?: string | null;
  transactions?: PassbookTransaction[] | null;
  rawText?: string | null;
};

export type Form7OwnershipEntry = {
  srNo?: string | null;
  ownerName?: string | null;
  area?: string | null;
  mutation?: string | null;
};

export type Form7Doc = {
  surveyNumber?: string | null;
  village?: string | null;
  taluka?: string | null;
  district?: string | null;
  ownershipEntries?: Form7OwnershipEntry[] | null;
  rawText?: string | null;
};

export type Form8aHolding = {
  surveyNumber?: string | null;
  area?: string | null;
  landRevenue?: string | null;
  remarks?: string | null;
};

export type Form8aDoc = {
  village?: string | null;
  taluka?: string | null;
  district?: string | null;
  khateNumber?: string | null;
  accountHolderName?: string | null;
  totalArea?: string | null;
  holdings?: Form8aHolding[] | null;
  rawText?: string | null;
};

export type Form12CropEntry = {
  year?: string | null;
  season?: string | null;
  cropName?: string | null;
  area?: string | null;
  irrigatedArea?: string | null;
  irrigationSource?: string | null;
};

export type Form12Doc = {
  village?: string | null;
  taluka?: string | null;
  district?: string | null;
  cropEntries?: Form12CropEntry[] | null;
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

export async function setPassbookOnUser(
  phone: string,
  passbook: PassbookDoc,
): Promise<UserDoc> {
  const db = await getDb();
  const users = db.collection<UserDoc>("users");
  const now = new Date().toISOString();
  await users.updateOne(
    { phone },
    {
      $setOnInsert: { phone, createdAt: now },
      $set: { passbook, updatedAt: now },
    },
    { upsert: true },
  );
  const doc = await users.findOne({ phone });
  return doc as UserDoc;
}

// ---------------------------------------------------------------------------
// New `profiles` collection — one document per phone, all 5 doc types nested.
// Used by /api/profiles and /api/extract.
// ---------------------------------------------------------------------------

export type ProfileDoc = {
  phone: string;
  name?: string | null;
  code?: string | null;
  createdAt: string;
  updatedAt: string;
  aadhar?: AadharDoc | null;
  passbook?: PassbookDoc | null;
  form7?: Form7Doc | null;
  form8a?: Form8aDoc | null;
  form12?: Form12Doc | null;
};

export type ProfileSection = "aadhar" | "passbook" | "form7" | "form8a" | "form12";

function generateProfileCode(phone: string): string {
  // Stable short code derived from phone — e.g. PA-7210 for ...3210
  const last4 = phone.slice(-4) || "0000";
  return `PA-${last4}`;
}

export async function ensureProfileDoc(
  phone: string,
  name?: string | null,
): Promise<{ profile: ProfileDoc; created: boolean }> {
  const db = await getDb();
  const profiles = db.collection<ProfileDoc>("profiles");
  const now = new Date().toISOString();

  const existing = await profiles.findOne({ phone });
  if (existing) {
    if (name && !existing.name) {
      await profiles.updateOne(
        { phone },
        { $set: { name, updatedAt: now } },
      );
      const updated = await profiles.findOne({ phone });
      return { profile: updated as ProfileDoc, created: false };
    }
    return { profile: existing as ProfileDoc, created: false };
  }

  const fresh: ProfileDoc = {
    phone,
    name: name ?? null,
    code: generateProfileCode(phone),
    createdAt: now,
    updatedAt: now,
    aadhar: null,
    passbook: null,
    form7: null,
    form8a: null,
    form12: null,
  };
  await profiles.insertOne(fresh);
  return { profile: fresh, created: true };
}

export async function getProfileDoc(phone: string): Promise<ProfileDoc | null> {
  const db = await getDb();
  const profiles = db.collection<ProfileDoc>("profiles");
  return (await profiles.findOne({ phone })) as ProfileDoc | null;
}

export async function setProfileSection(
  phone: string,
  section: ProfileSection,
  data: AadharDoc | PassbookDoc | Form7Doc | Form8aDoc | Form12Doc,
): Promise<ProfileDoc> {
  // Make sure a profile exists first
  await ensureProfileDoc(phone);
  const db = await getDb();
  const profiles = db.collection<ProfileDoc>("profiles");
  const now = new Date().toISOString();

  // If aadhar carries a name, lift it onto the top-level profile too.
  const extra: Partial<ProfileDoc> = {};
  if (section === "aadhar") {
    const a = data as AadharDoc;
    if (a.name) extra.name = a.name;
  }

  await profiles.updateOne(
    { phone },
    {
      $set: {
        [section]: data,
        updatedAt: now,
        ...extra,
      },
    },
  );
  const doc = await profiles.findOne({ phone });
  return doc as ProfileDoc;
}

export async function closeMongo(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
}
