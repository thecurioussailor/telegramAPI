import { Router } from "express";
import * as authController from "../controllers/authController";

export const authRouter = Router();

// whatsapp authentication
authRouter.post('/signup', authController.signup);
authRouter.post('/signin', authController.signin);