import { Router, type IRouter } from "express";
import { ensureProfileDoc, getProfileDoc } from "../lib/mongo";

const router: IRouter = Router();

function serialize(p: Awaited<ReturnType<typeof getProfileDoc>>) {
  if (!p) return null;
  return {
    phone: p.phone,
    name: p.name ?? null,
    code: p.code ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    aadhar: p.aadhar ?? null,
    passbook: p.passbook ?? null,
    form7: p.form7 ?? null,
    form8a: p.form8a ?? null,
    form12: p.form12 ?? null,
  };
}

router.post("/profiles", async (req, res) => {
  const body = req.body as { phone?: string; name?: string } | undefined;
  const phone = String(body?.phone ?? "").replace(/\D/g, "").trim();
  if (phone.length !== 10) {
    res.status(400).json({ error: "phone must be a 10-digit number" });
    return;
  }
  try {
    const { profile, created } = await ensureProfileDoc(
      phone,
      body?.name?.trim() || null,
    );
    res.status(created ? 201 : 200).json({
      profile: serialize(profile),
      created,
    });
  } catch (e) {
    req.log.error({ err: e }, "POST /profiles failed");
    res.status(500).json({ error: "Failed to create profile" });
  }
});

router.get("/profiles/:phone", async (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, "").trim();
  if (phone.length !== 10) {
    res.status(400).json({ error: "phone must be a 10-digit number" });
    return;
  }
  try {
    const doc = await getProfileDoc(phone);
    if (!doc) {
      res.status(404).json({ error: "profile not found" });
      return;
    }
    res.json({ profile: serialize(doc) });
  } catch (e) {
    req.log.error({ err: e }, "GET /profiles/:phone failed");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;
