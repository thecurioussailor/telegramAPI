import { Request, Response } from "express";
import { prismaClient } from "@repo/db/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const jwtSecret = process.env.JWT_SECRET;

export const signup = async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;

        if(!username || !password){
            res.status(400).json({
                error: "Invalid Credentials"
            });
            return
        }

        const existingUser = await prismaClient.user.findUnique({
            where: {
                username
            }
        })

        if (existingUser) {
            res.status(403).json({
                error: "User already exists"
            });
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prismaClient.user.create({
            data: {
                username,
                password: hashedPassword
            }
        });

        const token = jwt.sign({ userId: newUser.id }, jwtSecret!);

        res.status(201).json({ message: "User created successfully",
            token
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({
            error: "Internal Server Error"
        })
    }
}
export const signin = async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            res.status(400).json({
                error: "Invalid Credentials"
            });
            return;
        }

        const user = await prismaClient.user.findUnique({
            where: {
                username
            }
        });

        if (!user) {
            res.status(404).json({
                error: "User not found"
            });
            return;
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            res.status(403).json({
                error: "Invalid Credentials"
            });
            return;
        }

        const token = jwt.sign({ userId: user.id }, jwtSecret!);

        res.status(200).json({
            message: "Signin successful",
            token
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({
            error: "Internal Server Error"
        })
    }
}