import { Router } from "express";
import * as telegramController from "../controllers/telegramController";
import { authenticate } from "../middleware/authenticate";
export const telegramRouter = Router();

telegramRouter.post('/requestOTP', authenticate, telegramController.requestOTP);
telegramRouter.post('/sendCode', authenticate, telegramController.verifyCode);
telegramRouter.post('/createChannel', authenticate, telegramController.createTelegramChannel);
telegramRouter.post('/addBot', authenticate, telegramController.addBotToChannel);
telegramRouter.post('/addUser', authenticate, telegramController.addUserToChannel);
telegramRouter.post('/listChannels', authenticate, telegramController.listChannels);
telegramRouter.post('/removeUser', authenticate, telegramController.removeUserFromChannel);

//via telegram bot
telegramRouter.post('/banUser', authenticate, telegramController.banUserFromChannel);
telegramRouter.post('/unbanUser', authenticate, telegramController.unbanUserFromChannel);