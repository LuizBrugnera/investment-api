import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export const validateSessionToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
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
    next();
  });
};
