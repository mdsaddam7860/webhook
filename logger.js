const fs = require("fs");
const path = require("path");

// Define log file path
const logDir = path.join(__dirname, "logs");
const logFile = path.join(logDir, "server.log");

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Logger function
function logMessage(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;

  // ✅ Print in Cloudways terminal
  console.log(message);

  // ✅ Write to file
  fs.appendFile(logFile, logEntry, (err) => {
    if (err) {
      console.error("❌ Failed to write to log file:", err);
    }
  });
}

export { logMessage };
