import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "080205";

// On Vercel, __dirname is read-only — use /tmp instead
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL
  ? path.join("/tmp", "vcf-data")
  : path.join(__dirname, "data");
const CONTACTS_FILE = path.join(DATA_DIR, "contacts.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readContacts() {
  ensureDataDir();
  if (!fs.existsSync(CONTACTS_FILE)) {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeContacts(contacts) {
  ensureDataDir();
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

function requireAdmin(req, res, next) {
  const pw = req.headers["x-admin-password"] || req.query["pw"];
  if (pw !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  next();
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// PUBLIC: total count only — no phone numbers
app.get("/api/contacts", (req, res) => {
  const contacts = readContacts();
  res.json({ total: contacts.length });
});

// PUBLIC: add a contact
app.post("/api/contacts", (req, res) => {
  const { name, countryCode, phone } = req.body;
  if (!name || !countryCode || !phone) {
    return res.status(400).json({ error: "name, countryCode, and phone are required" });
  }
  const contacts = readContacts();
  const cleanPhone = String(phone).replace(/\s+/g, "");
  const duplicate = contacts.find(
    (c) => c.countryCode === countryCode && c.phone === cleanPhone
  );
  if (duplicate) {
    return res.status(409).json({ error: "This phone number already exists" });
  }
  const newContact = {
    id: crypto.randomUUID(),
    name: String(name),
    countryCode: String(countryCode),
    phone: cleanPhone,
    createdAt: new Date().toISOString(),
  };
  contacts.push(newContact);
  writeContacts(contacts);
  return res.status(201).json(newContact);
});

// ADMIN: get all contacts
app.get("/api/admin/contacts", requireAdmin, (req, res) => {
  const contacts = readContacts();
  res.json({ contacts, total: contacts.length });
});

// ADMIN: delete a contact
app.delete("/api/admin/contacts/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const contacts = readContacts();
  const idx = contacts.findIndex((c) => c.id === id);
  if (idx === -1) return res.status(404).json({ error: "Contact not found" });
  contacts.splice(idx, 1);
  writeContacts(contacts);
  return res.sendStatus(204);
});

// ADMIN: edit a contact (name, countryCode, phone)
app.patch("/api/admin/contacts/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, countryCode, phone } = req.body;
  const contacts = readContacts();
  const idx = contacts.findIndex((c) => c.id === id);
  if (idx === -1) return res.status(404).json({ error: "Contact not found" });

  const existing = contacts[idx];
  const updatedPhone = phone ? String(phone).replace(/\s+/g, "") : existing.phone;
  const updatedCountry = countryCode ? String(countryCode) : existing.countryCode;
  const updatedName = name !== undefined ? String(name) : existing.name;

  // Check for duplicate phone on a different contact
  const duplicate = contacts.find(
    (c, i) =>
      i !== idx &&
      c.countryCode === updatedCountry &&
      c.phone === updatedPhone
  );
  if (duplicate) {
    return res.status(409).json({ error: "This phone number already exists" });
  }

  contacts[idx] = {
    ...existing,
    name: updatedName,
    countryCode: updatedCountry,
    phone: updatedPhone,
    updatedAt: new Date().toISOString(),
  };

  writeContacts(contacts);
  return res.json(contacts[idx]);
});

// ADMIN: delete ALL contacts
app.delete("/api/admin/contacts", requireAdmin, (req, res) => {
  writeContacts([]);
  return res.sendStatus(204);
});

// ADMIN: download VCF
app.get("/api/admin/contacts/vcf", requireAdmin, (req, res) => {
  const contacts = readContacts();
  const lines = [];
  for (const c of contacts) {
    lines.push("BEGIN:VCARD");
    lines.push("VERSION:3.0");
    lines.push(`FN:${c.name}`);
    lines.push(`TEL;TYPE=CELL:${c.countryCode}${c.phone}`);
    lines.push("END:VCARD");
  }
  res.setHeader("Content-Type", "text/vcard");
  res.setHeader("Content-Disposition", "attachment; filename=contacts.vcf");
  return res.send(lines.join("\r\n"));
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`VCF Collector running at http://0.0.0.0:${PORT}`);
});
