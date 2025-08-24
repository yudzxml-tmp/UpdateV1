const formidable = require("formidable");
const admin = require("firebase-admin");
const axios = require("axios");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// --- Upload file buffer ke CDN GitHub via Vercel ---
async function YudzGithubCdn(fileBuffer, fileName) {
  try {
    const response = await axios.post(
      "https://api-upload-cyan.vercel.app/api/upload",
      fileBuffer,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "x-filename": fileName,
        },
      }
    );
    return response.data;
  } catch (err) {
    return { error: err.response?.data || err.message };
  }
}

// --- Ambil semua update dari Firestore ---
async function getUpdates() {
  const snapshot = await db.collection("updates").orderBy("updateDate", "desc").get();
  const updates = [];
  snapshot.forEach((doc) => updates.push(doc.data()));
  return { status: 200, data: updates };
}

// --- Handler API ---
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const { key } = req.query;
    if (key !== "YUDZXMLDEVX7BOTZ")
      return res.status(400).json({ error: "Key tidak valid." });

    try {
      const data = await getUpdates();
      return res.status(200).json(data);
    } catch (err) {
      console.error("GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_SECRET_KEY)
      return res.status(403).json({ error: "Forbidden: Admin key salah" });

    const form = formidable({ multiples: false, keepExtensions: true });

    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ error: err.message });

      try {
        const author = String(fields.author?.[0] || "");
        const title = String(fields.title?.[0] || "");
        const version = String(fields.version?.[0] || "");
        const keyScript = String(fields.keyScript?.[0] || "");
        const versionType = String(fields.versionType?.[0] || "").toLowerCase();

        const file = files.file?.[0];
        if (!author || !title || !version || !keyScript || !versionType || !file)
          return res.status(400).json({ error: "Semua field wajib diisi + file wajib ada" });

        if (!["full", "lite"].includes(versionType))
          return res.status(400).json({ error: "versionType harus 'full' atau 'lite'" });

        const fileBuffer = file.filebuffer || file._writeStream?.buffer;
        if (!fileBuffer) {
          throw new Error("File buffer tidak ditemukan");
        }

        const fileName = `updates-${versionType}-${Date.now()}-${title}.zip`;
        const cdnResult = await YudzGithubCdn(fileBuffer, fileName);

        if (cdnResult.error) {
          throw new Error(cdnResult.error);
        }

        const updateDate = new Date().toISOString();
        const docId = `${versionType}-${Date.now()}`;
        const docRef = db.collection("updates").doc(docId);

        const newData = {
          author,
          title,
          version,
          keyScript,
          versionType,
          updateDate,
          url: cdnResult.data.url || cdnResult.url || "",
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
    });

    return;
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).json({ error: `Method ${req.method} Not Allowed` });
};