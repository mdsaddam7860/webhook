import dotenv from "dotenv";

dotenv.config();
import express from "express";
import axios from "axios";
import { logMessage } from "./logger";

const app = express();
const PORT = process.env.PORT || 5000;
const FROM_NUMBER = "+12016446523";

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.get("/", (req, res) => {
  res.send("<h1>🚀 App is running</h1>");
});

// ✅ Webhook endpoint
app.post("/webhook", (req, res) => {
  logMessage("📩 Webhook received at " + new Date().toISOString());

  // ✅ Respond immediately to HubSpot (prevents timeouts)
  res.status(204).send();

  // ✅ Process webhook asynchronously after response
  setImmediate(async () => {
    try {
      let requestBody = req.body;

      if (typeof requestBody === "string") {
        try {
          requestBody = JSON.parse(requestBody);
        } catch {
          logMessage("❌ Invalid JSON format in request body");
          return;
        }
      }

      logMessage("Parsed request body: " + JSON.stringify(requestBody));

      const firstEvent = Array.isArray(requestBody)
        ? requestBody[0]
        : requestBody;
      const { objectId } = firstEvent || {};
      if (!objectId) {
        logMessage("❌ Missing objectId in request body");
        return;
      }

      logMessage(`📦 Received objectId: ${objectId}`);

      // ✅ Fetch contact from HubSpot
      const hubspotResponse = await axios.get(
        `https://api.hubapi.com/crm/v3/objects/contacts/${objectId}?properties=firstname,phone,hs_analytics_source,of_times_sms_sent`,
        {
          headers: {
            Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const contact = hubspotResponse.data;
      logMessage(`📋 Contact fetched: ${JSON.stringify(contact)}`);

      const firstName = contact.properties.firstname || "there";
      const toPhoneNumber = contact.properties.phone;

      if (!toPhoneNumber) {
        logMessage(`❌ No phone number found for contact ID ${objectId}`);
        return;
      }

      // ✅ Normalize phone number
      const cleanNumber = toPhoneNumber.replace(/\D/g, "");
      let toPhoneNumberFormatted = toPhoneNumber;

      if (!toPhoneNumber.startsWith("+")) {
        if (cleanNumber.length === 10) {
          toPhoneNumberFormatted = `+1${cleanNumber}`;
        } else if (cleanNumber.length === 11 && cleanNumber.startsWith("1")) {
          toPhoneNumberFormatted = `+${cleanNumber}`;
        } else {
          toPhoneNumberFormatted = `+1${cleanNumber}`;
        }

        logMessage(
          `📞 Formatting phone: ${toPhoneNumber} → ${toPhoneNumberFormatted}`
        );

        try {
          await axios.patch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${objectId}`,
            { properties: { phone: toPhoneNumberFormatted } },
            {
              headers: {
                Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
                "Content-Type": "application/json",
              },
            }
          );
          logMessage(`✅ Phone updated in HubSpot for ID ${objectId}`);
        } catch (error) {
          logMessage(`⚠️ Failed to update phone: ${error.message}`);
        }
      }

      // ✅ Check OpenPhone conversation history
      const openPhoneMessages = await axios.get(
        `https://api.openphone.com/v1/messages?maxResults=10&phoneNumberId=PNBMjYijdv&participants=${encodeURIComponent(
          toPhoneNumberFormatted
        )}`,
        {
          headers: { Authorization: process.env.OPENPHONE_API_KEY },
        }
      );

      const messages = openPhoneMessages.data.data || [];
      const userReplied = messages.some((msg) => msg.to.includes(FROM_NUMBER));

      if (userReplied) {
        logMessage(`✅ User ${toPhoneNumberFormatted} has already replied`);
        return;
      }

      // ✅ Fetch message templates
      const messageTextsResponse = await axios.get(
        "https://api.hubapi.com/crm/v3/objects/2-45109637?properties=message_,message_text&limit=100",
        {
          headers: {
            Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const messageTexts = messageTextsResponse.data.results.map((item) => ({
        message: item.properties.message_,
        message_text: item.properties.message_text,
      }));

      const messageById = messageTexts.find(
        (item) => item.message === contact.properties.of_times_sms_sent
      )?.message_text;

      if (!messageById) {
        logMessage(
          `❌ No message text found for of_times_sms_sent: ${contact.properties.of_times_sms_sent}`
        );
        return;
      }

      const messageContent = messageById.replace("{First Name}", firstName);
      logMessage(
        `📤 Sending message to ${toPhoneNumberFormatted}: ${messageContent}`
      );

      // ✅ Send message via OpenPhone
      await axios.post(
        process.env.OPENPHONE_API_URL,
        {
          content: messageContent,
          from: FROM_NUMBER,
          to: [toPhoneNumberFormatted],
        },
        {
          headers: {
            Authorization: process.env.OPENPHONE_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      logMessage(`✅ Message sent successfully to ${toPhoneNumberFormatted}`);
    } catch (error) {
      const errorData = error.response?.data || error.message;
      logMessage("❌ Error occurred: " + JSON.stringify(errorData));
    }
  });
});

// ✅ Handle large payload errors
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    logMessage("❌ Payload too large");
    return res.status(413).json({ error: "Payload too large" });
  }
  next(err);
});

app.listen(PORT, () => {
  const msg = `Webhook server listening on port ${PORT}`;
  logMessage(msg);
});
