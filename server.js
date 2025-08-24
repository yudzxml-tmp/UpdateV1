const express = require("express");
const path = require("path");
const admin = require("firebase-admin");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(bodyParser.json({ limit: "50mb" })); // untuk menerima fileBase64 besar
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Serve file statis dari folder 'public' (index.html ada di sini)
app.use(express.static(path.join(__dirname, "public")));

// --- Inisialisasi Firebase Admin ---
if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT tidak ditemukan di env!");
  }
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// --- Fungsi Upload ke CDN ---
async function uploadToCdn(fileBuffer, fileName) {
  try {
    const response = await axios.post(
      process.env.CDN_UPLOAD_URL || "https://api-upload-cyan.vercel.app/api/upload",
      fileBuffer,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "x-filename": fileName,
        },
        timeout: 30000,
      }
    );
    return response.data;
  } catch (err) {
    return { error: err.response?.data || err.message };
  }
}

// --- Fungsi ambil updates ---
async function getUpdates() {
  const snapshot = await db.collection("updates").orderBy("updateDate", "desc").get();
  return { status: 200, data: snapshot.docs.map(doc => doc.data()) };
}

// --- Route API ---
app.all("/api/updates", async (req, res) => {
  // Header CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");

  if (req.method === "OPTIONS") return res.status(200).end();

  // GET -> ambil update
  if (req.method === "GET") {
    const { key } = req.query;
    if (key !== process.env.PUBLIC_KEY)
      return res.status(400).json({ error: "Key tidak valid." });

    try {
      const data = await getUpdates();
      return res.status(200).json(data);
    } catch (err) {
      console.error("GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST -> upload update
  if (req.method === "POST") {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_SECRET_KEY)
      return res.status(403).json({ error: "Forbidden: Admin key salah" });

    try {
      const { author, title, version, keyScript, versionType, fileBase64 } = req.body;

      if (!author || !title || !version || !keyScript || !versionType || !fileBase64)
        return res.status(400).json({ error: "Semua field wajib diisi + fileBase64 wajib ada" });

      if (!["full", "lite"].includes(versionType.toLowerCase()))
        return res.status(400).json({ error: "versionType harus 'full' atau 'lite'" });

      const fileBuffer = Buffer.from(fileBase64, "base64");
      const fileName = `updates-${versionType.toLowerCase()}-${Date.now()}-${title}.zip`;

      const cdnResult = await uploadToCdn(fileBuffer, fileName);
      if (cdnResult.error) throw new Error(cdnResult.error);

      const updateDate = new Date().toISOString();
      const docId = `${versionType.toLowerCase()}-${Date.now()}`;
      const docRef = db.collection("updates").doc(docId);

      const newData = {
        author,
        title,
        version,
        keyScript,
        versionType: versionType.toLowerCase(),
        updateDate,
        url: cdnResult.data?.url || cdnResult.url || "",
      };

      await docRef.set(newData);

      return res.status(200).json({
        success: true,
        message: `Update '${versionType}' berhasil diupload ke CDN`,
        data: newData,
      });
    } catch (err) {
      console.error("Upload error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
});

// --- Route fallback untuk SPA / index.html ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Jalankan server ---
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});