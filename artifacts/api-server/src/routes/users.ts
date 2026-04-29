import { Router, type IRouter } from "express";
import { getUserDoc, upsertUserDoc } from "../lib/mongo";

const router: IRouter = Router();

router.post("/users", async (req, res) => {
  const phone = String((req.body as { phone?: string } | undefined)?.phone ?? "")
    .replace(/\D/g, "")
    .trim();
  if (!phone) {
    res.status(400).json({ error: "phone is required" });
    return;
  }
  try {
    const doc = await upsertUserDoc(phone);
    res.json(serialize(doc));
  } catch (e) {
    req.log.error({ err: e }, "upsertUser failed");
    res.status(500).json({ error: "Failed to upsert user" });
  }
});

router.get("/users/:phone", async (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, "").trim();
  if (!phone) {
    res.status(400).json({ error: "phone is required" });
    return;
  }
  try {
    const doc = await getUserDoc(phone);
    if (!doc) {
      const created = await upsertUserDoc(phone);
      res.json(serialize(created));
      return;
    }
    res.json(serialize(doc));
  } catch (e) {
    req.log.error({ err: e }, "getUser failed");
    res.status(500).json({ error: "Failed to get user" });
  }
});

function serialize(doc: {
  phone: string;
  createdAt: string;
  updatedAt: string;
  aadhar?: unknown;
  passbook?: unknown;
}) {
  return {
    phone: doc.phone,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    aadhar: doc.aadhar ?? null,
    passbook: doc.passbook ?? null,
  };
}

export default router;
