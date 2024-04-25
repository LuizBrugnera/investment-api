import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { validateSessionToken } from "./authMiddleware";
import bodyParser from "body-parser";
import cors from "cors";
import multer from "multer";
import path from "path";

const app = express();
const prisma = new PrismaClient();
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "dist/uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix);
  },
});
const upload = multer({ storage: storage });

app.use(
  cors({
    origin: "*",
  })
);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/* 
app.get("/user", validateSessionToken, async (req: Request, res: Response) => {
  const users = await prisma.user.findMany();

  res.json(users);
});

*/
app.post("/user", async (req: Request, res: Response) => {
  const { email, fullname, password, phone, username } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 8);
  const newUser = await prisma.user.create({
    data: {
      username,
      email,
      password: hashedPassword,
      fullname,
      phone,
      role: "USER",
    },
  });
  res.json(newUser);
});

app.post(
  "/contract",
  validateSessionToken,
  upload.single("documentArchive"),
  async (req: Request, res: Response) => {
    try {
      const { documentString, documentType, investmentType, method, value } =
        req.body;

      const token = String(req.headers["authorization"]).replace("Bearer ", "");

      if (!token) return res.sendStatus(401);

      jwt.verify(token, process.env.SECRET_KEY!, (err, session) => {
        if (err) {
          if (err.name === "TokenExpiredError") {
            return res.sendStatus(401);
          }
          return res.sendStatus(403);
        }
        req.body.session = session;
      });

      const userId = req.body.session.id;

      const startDate = new Date();
      let endDate;
      if (investmentType === "SIX_MONTHS") {
        endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 6);
      } else if (investmentType === "ONE_YEAR") {
        endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        return res.status(400).json({ error: "Invalid investment type" });
      }
      if (!userId || !documentType || !investmentType || !method || !value) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      let documentUrl = documentString || "Arquivo";
      if (req.file) {
        documentUrl = `${req.protocol}://${req.get("host")}/uploads/${
          req.file.filename
        }`;
      }

      const newContract = await prisma.contract.create({
        data: {
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          documentString,
          documentUrl,
          documentType,
          investmentType,
          method,
          status: "PENDING",
          value: +value,
          userId,
        },
      });
      res.json(newContract);
    } catch (error) {
      console.error(error);
      res.status(500).send("Server error");
    }
  }
);

/* 
app.get(
  "/contract",
  validateSessionToken,
  async (req: Request, res: Response) => {
    const contracts = await prisma.contract.findMany();

    res.json(contracts);
  }
);

*/
/* 
app.get(
  "/contract/:id",
  validateSessionToken,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const contract = await prisma.contract.findUnique({
      where: { id: Number(id) },
    });

    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    res.json(contract);
  }
);
*/

app.get("/download-archive/:filename", async (req, res) => {
  const { filename } = req.params;

  const filePath = path.join(__dirname, "uploads", filename);

  res.download(filePath, (err) => {
    if (err) {
      res.status(404).send("File not found.");
    }
  });
});

app.get(
  "/user/contract",
  validateSessionToken,
  async (req: Request, res: Response) => {
    if (req.body.session.role === "ADMIN") {
      const contracts = await prisma.contract.findMany();

      return res.json(contracts);
    }

    const id = req.body.session.id;

    const contracts = await prisma.contract.findMany({
      where: { userId: Number(id) },
    });

    res.json(contracts);
  }
);

app.get(
  "/user/saldo",
  validateSessionToken,
  async (req: Request, res: Response) => {
    const userId = req.body.session.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const contracts = await prisma.contract.findMany({
      where: { userId: userId, status: "APPROVED" },
    });

    const contractsWithSaldo = contracts
      .filter((contract) => contract.method === "SALDO")
      .reduce((acc, contract) => acc + contract.value, 0);

    const today = new Date();
    const saldo =
      contracts.reduce((acc, contract) => {
        const startDate = new Date(contract.startDate);
        const endDate = new Date(contract.endDate);
        const actualEndDate = endDate > today ? today : endDate;
        const durationDays =
          (actualEndDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);

        const monthlyPercentage = {
          SIX_MONTHS: 20,
          ONE_YEAR: 22,
        };

        const profit =
          contract.value *
          (monthlyPercentage[
            contract.investmentType as keyof typeof monthlyPercentage
          ] /
            30 /
            100) *
          durationDays;
        return acc + profit;
      }, 0) - contractsWithSaldo;

    res.json({ saldo });
  }
);

app.post(
  "/contract/saldo",
  validateSessionToken,
  async (req: Request, res: Response) => {
    const userId = req.body.session.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const contracts = await prisma.contract.findMany({
      where: { userId: userId, status: "APPROVED" },
    });

    const contractsWithSaldo = contracts
      .filter((contract) => contract.method === "SALDO")
      .reduce((acc, contract) => acc + contract.value, 0);

    const today = new Date();
    const saldo =
      contracts.reduce((acc, contract) => {
        const startDate = new Date(contract.startDate);
        const endDate = new Date(contract.endDate);
        const actualEndDate = endDate > today ? today : endDate;
        const durationDays =
          (actualEndDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);

        const monthlyPercentage = {
          SIX_MONTHS: 20,
          ONE_YEAR: 22,
        };

        const profit =
          contract.value *
          (monthlyPercentage[
            contract.investmentType as keyof typeof monthlyPercentage
          ] /
            30 /
            100) *
          durationDays;

        return acc + profit;
      }, 0) - contractsWithSaldo;

    const { documentString, documentType, investmentType, method, value } =
      req.body;

    console.log(value);
    console.log(investmentType);

    if (saldo < +value) {
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    const startDate = new Date();
    let endDate;
    if (investmentType === "SIX_MONTHS") {
      endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 6);
    } else if (investmentType === "ONE_YEAR") {
      endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      return res.status(400).json({ error: "Invalid investment type" });
    }
    if (!userId || !documentType || !investmentType || !method || !value) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let documentUrl = documentString || "Arquivo";
    const newContract = await prisma.contract.create({
      data: {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        documentString,
        documentUrl,
        documentType,
        investmentType,
        method,
        status: "APPROVED",
        value: +value,
        userId,
      },
    });
    res.json(newContract);
  }
);

app.get(
  "/user/balance",
  validateSessionToken,
  async (req: Request, res: Response) => {
    const id = req.body.session.id;
    const user = await prisma.user.findUnique({
      where: { id: Number(id) },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const contracts = await prisma.contract.findMany({
      where: {
        userId: Number(id),
        status: "APPROVED",
      },
    });

    const balance = contracts.reduce((acc, contract) => {
      return acc + contract.value;
    }, 0);

    res.json({ balance });
  }
);

app.post("/login", async (req: Request, res: Response) => {
  try {
    console.log("logando");
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && bcrypt.compareSync(password, user.password)) {
      const token = jwt.sign(
        {
          id: user.id,
          role: user.role,
          email: user.email,
          username: user.username,
          fullname: user.fullname,
        },
        process.env.SECRET_KEY as string,
        { expiresIn: "12h" }
      );
      return res.json({ token });
    }
    res.status(401).send("Credentials are not valid");
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

app.put(
  "/contract/:id/:status",
  validateSessionToken,
  async (req: Request, res: Response) => {
    const { id, status } = req.params;

    if (req.body.session.role !== "ADMIN") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const contract = await prisma.contract.findUnique({
      where: { id: Number(id) },
    });

    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    if (contract.status === "APPROVED") {
      return res.status(400).json({ error: "Contract already approved" });
    }

    if (status !== "APPROVED" && status !== "REJECTED") {
      return res.status(400).json({ error: "Invalid status" });
    }

    const updatedContract = await prisma.contract.update({
      where: { id: Number(id) },
      data: {
        status,
      },
    });

    res.json(updatedContract);
  }
);

const PORT = 5173; // const PORT = 3000; //

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
