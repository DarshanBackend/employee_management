import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import helmet from "helmet";
import cors from "cors";
import logger from "morgan";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "./DB/connectdb.js";
import IndexRoute from "./routes/index.routes.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger("dev"));
app.use("/public", express.static("public"));

const DB_URL =
  process.env.DB_URL ||
  "mongodb+srv://mehulkalathiyainfotech:euMEtsN4B8ZfmXCk@cluster0.lhctupx.mongodb.net/language_learning";
connectDB(DB_URL);

app.get("/", async (req, res) => {
  return res.send("<h1>Language_Learning AI Voice Tutor API is working!</h1>");
});

app.get("/health", async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus =
    dbState === 1
      ? "connected"
      : dbState === 2
        ? "connecting"
        : dbState === 3
          ? "disconnecting"
          : "disconnected";

  res.json({
    server: "running",
    database: dbStatus,
    timestamp: new Date(),
  });
});

app.use("/api", IndexRoute);

const PORT = process.env.PORT || 9000;
httpServer.listen(PORT, () => {
  console.log(`Language_Learning Server is running on port : ${PORT}`);
});
