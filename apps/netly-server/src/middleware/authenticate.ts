import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const jwtSecret = process.env.JWT_SECRET;

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const headers = req.headers;
        const token = headers.authorization?.split(' ')[1];
        if(!token){
            res.status(400).json({
                error: "Invalid Token"
            })
            return
        }

        const decoded = jwt.verify(token, jwtSecret!) as { userId: string}
        req.userId = decoded.userId;
        next();
    } catch (error) {
        console.log(error);
        res.status(400).json({
            error: "Unauthorized"
        })
    }
}