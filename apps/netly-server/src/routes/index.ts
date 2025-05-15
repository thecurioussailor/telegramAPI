import { Router } from "express";
import { telegramRouter } from "./telegram";
import { authRouter } from "./auth";

export const router = Router();

router.use('/auth', authRouter);
router.use('/telegram', telegramRouter);