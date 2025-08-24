const { google } = require("googleapis");
const { formidable } = require("formidable");
const admin = require("firebase-admin");
const stream = require("stream");
const fs = require("fs");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

const driveAuth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = google.drive({ version: "v3", auth: driveAuth });

// --- Upload file ke Google Drive via stream ---
async function uploadFileStreamToDrive(filePath, fileName, mimetype, folderId) {
  console.log("Uploading file to Drive:", { filePath, fileName, mimetype, folderId });

  const fileStream = fs.createReadStream(filePath);
  const bufferStream = new stream.PassThrough();
  fileStream.pipe(bufferStream);

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: mimetype, body: bufferStream },
    fields: "id, webViewLink, webContentLink",
  });

  console.log("Upload result:", response.data);

  return {
    fileId: response.data.id,
    viewLink: response.data.webViewLink,
    downloadLink: response.data.webContentLink,
  };
}

// --- Ambil data update terakhir ---
async function updatebot() {
  const docRef = db.collection("updates").doc("bot");
  const doc = await docRef.get();
  if (!doc.exists) throw new Error("Data update tidak ditemukan di Firestore");
  return { status: 200, data: doc.data() };
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
      const data = await updatebot();
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
    console.log("Fields received:", fields);
    console.log("Files received:", files);

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

    const filePath = file.filepath || file.path;
    if (!filePath) return res.status(500).json({ error: "File path tidak ditemukan" });

    const fileName = `updates-${versionType}-${Date.now()}-${title}.zip`;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const fileDrive = await uploadFileStreamToDrive(filePath, fileName, file.mimetype, folderId);

    const updateDate = new Date().toISOString();
    const docRef = db.collection("updates").doc("bot");
    const doc = await docRef.get();
    const oldData = doc.exists ? doc.data() : {};

    const newData = {
      author,
      title,
      version,
      keyScript,
      updateDate,
      url_full: versionType === "full" ? fileDrive.downloadLink : oldData.url_full || "",
      url_lite: versionType === "lite" ? fileDrive.downloadLink : oldData.url_lite || "",
    };

    console.log("New data to save:", newData);

    await docRef.set(newData);

    return res.status(200).json({
      success: true,
      message: `Update '${versionType}' berhasil diupload ke Google Drive`,
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
