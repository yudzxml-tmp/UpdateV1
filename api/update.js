const { google } = require("googleapis");
const { Busboy } = require("busboy");
const admin = require("firebase-admin");
const stream = require("stream");

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

async function uploadBufferToDrive(buffer, fileName, mimetype, folderId) {
const bufferStream = new stream.PassThrough();
bufferStream.end(buffer);
const response = await drive.files.create({
requestBody: { name: fileName, parents: [folderId] },
media: { mimeType: mimetype, body: bufferStream },
fields: "id, webViewLink, webContentLink",
});
return {
fileId: response.data.id,
viewLink: response.data.webViewLink,
downloadLink: response.data.webContentLink,
};
}

async function updatebot() {
const docRef = db.collection("updates").doc("bot");
const doc = await docRef.get();
if (!doc.exists) throw new Error("Data update tidak ditemukan di Firestore");
return { status: 200, data: doc.data() };
}

module.exports = async (req, res) => {
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");

if (req.method === "OPTIONS") return res.status(200).end();

if (req.method === "GET") {
const { key } = req.query;
if (key !== "YUDZXMLDEVX7BOTZ") return res.status(400).json({ error: "Key tidak valid." });
try {
const data = await updatebot();
return res.status(200).json(data);
} catch (err) {
return res.status(500).json({ error: err.message });
}
}

if (req.method === "POST") {
const adminKey = req.headers["x-admin-key"];
if (adminKey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "Forbidden: Admin key salah" });

const busboy = new Busboy({ headers: req.headers });  
const fields = {};  
const fileData = [];  

busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {  
  file.on("data", (data) => fileData.push(data));  
});  

busboy.on("field", (fieldname, val) => {  
  fields[fieldname] = val;  
});  

busboy.on("finish", async () => {  
  try {  
    const { author, title, version, keyScript, versionType } = fields;  
    if (!author || !title || !version || !keyScript || !versionType || fileData.length === 0)  
      return res.status(400).json({ error: "Semua field wajib diisi + file wajib ada" });  
    if (!["full", "lite"].includes(versionType.toLowerCase()))  
      return res.status(400).json({ error: "versionType harus 'full' atau 'lite'" });  

    const buffer = Buffer.concat(fileData);  
    const fileName = `updates-${versionType}-${Date.now()}-${title}.zip`;  
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;  
    const fileDrive = await uploadBufferToDrive(buffer, fileName, "application/zip", folderId);  

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
      url_full: versionType.toLowerCase() === "full" ? fileDrive.downloadLink : oldData.url_full || "",  
      url_lite: versionType.toLowerCase() === "lite" ? fileDrive.downloadLink : oldData.url_lite || "",  
    };  

    await docRef.set(newData);  

    return res.status(200).json({  
      success: true,  
      message: `Update '${versionType}' berhasil diupload ke Google Drive`,  
      data: newData,  
    });  
  } catch (err) {  
    return res.status(500).json({ error: err.message });  
  }  
});  

req.pipe(busboy);  
return;

}

res.setHeader("Allow", ["GET", "POST"]);
res.status(405).json({ error: `Method ${req.method} Not Allowed` });
};