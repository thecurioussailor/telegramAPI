import { Request, Response } from "express"
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import dotenv from "dotenv";
import { prismaClient } from "@repo/db/client";
dotenv.config();

const apiId: number = Number(process.env.API_ID);
const apiHash: string = process.env.API_HASH || '';

const botToken = process.env.BOT_TOKEN;

export const requestOTP = async( req: Request, res: Response) => {
    try {
        const { phoneNumber } = req.body;
        const userId = req.userId;
        if(!phoneNumber){
            res.status(400).json({
                error: "Phone number required"
            })
            return
        };

        const stringSession = new StringSession('');
        const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5});
        await client.connect();

        const result = await client.invoke(
            new Api.auth.SendCode({
              phoneNumber: phoneNumber,
              apiId: apiId,
              apiHash: apiHash,
              settings: new Api.CodeSettings({}),
            })
          );
        
        if(!result){
            res.status(400).json({
                error: "Error try again later"
            })
            return
        }
        const phoneCodeHash = (result as any).phoneCodeHash || (result as any).phone_code_hash;
        const user = await prismaClient.user.update({
            where: {
                id: userId
            },
            data: {
                session: stringSession.save(),
                phoneNumber: phoneNumber,
                phoneCodeHash: phoneCodeHash
            }
        })
        
        res.status(200).json({
            message: "OTP sent successfully",
            user: {
                id: user.id
            }
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            error: "Internal Server Error"
        })
    }
}

export const verifyCode = async(req: Request, res: Response) => {
 
    const { code } = req.body;
    const userId = req.userId;
    
    if(!code) {
        res.status(400).json({
            error: "Verification code is required"
        });
        return
    }
    
    // Get user data with session and phoneCodeHash
    const user = await prismaClient.user.findUnique({
        where: {
            id: userId
        }
    });
    
    if(!user || !user.session || !user.phoneNumber || !user.phoneCodeHash) {
        res.status(400).json({
            error: "Please request OTP first"
        });
        return
    }
    
    // Create client with saved session
    const stringSession = new StringSession(user.session);
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    
    // Sign in with the code
    try {
        const result = await client.invoke(
            new Api.auth.SignIn({
                phoneNumber: String(user.phoneNumber),
                phoneCodeHash: user.phoneCodeHash,
                phoneCode: code
            })
        );
        
        // Save the updated session
        await prismaClient.user.update({
            where: {
                id: userId
            },
            data: {
                session: stringSession.save(),
                authenticated: true
            }
        });
        
        res.status(200).json({
            message: "Verification successful",
            user: {
                id: user.id,
                authenticated: true
            }
        });
    } catch (signInError: any) {
        console.log("Sign in error:", signInError);
        
        // Handle specific Telegram API errors
        if (signInError.message && signInError.message.includes("SESSION_PASSWORD_NEEDED")) {
            res.status(400).json({
                error: "Two-factor authentication is enabled. Please use another method."
            });
            return 
        }
        
        res.status(400).json({
            error: "Invalid verification code"
        });
    }
}

export const createTelegramChannel = async(req: Request, res: Response) => {
    const { channelName, channelDescription } = req.body;
    const userId = req.userId;
    
    if(!channelName) {
        res.status(400).json({
            error: "Channel name is required"
        });
        return
    }
    
    // Get user data with session
    const user = await prismaClient.user.findUnique({
        where: {
            id: userId
        }
    });
    
    if(!user || !user.session || user.authenticated !== true) {
        res.status(400).json({
            error: "Please verify your Telegram account first"
        });
        return
    }
    
    // Create client with saved session
    const stringSession = new StringSession(user.session);
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    
    // Check if user is logged in
    if(!await client.isUserAuthorized()) {
            res.status(401).json({
            error: "User not authorized on Telegram"
        });
        return
    }
    
    // Create the channel
    try {
        const result = await client.invoke(
            new Api.channels.CreateChannel({
                title: channelName,
                about: channelDescription || "",
                broadcast: true,
                megagroup: false
            })
        );
        // Extract channel info from the result
        // Using type assertion since the Telegram API types might not match exactly
        const channelData = (result as any).chats?.[0];
        
        if (!channelData || !channelData.id) {
            res.status(400).json({
                error: "Failed to retrieve channel information"
            });
            return
        }
        
        // Save channel info to database
        const savedChannel = await prismaClient.channel.create({
            data: {
                telegramId: channelData.id,
                title: channelName,
                description: channelDescription || "",
                ownerId: userId
            }
        });
        
        res.status(201).json({
            message: "Channel created successfully",
            channel: savedChannel
        });
    } catch (channelError: any) {
        console.log("Channel creation error:", channelError);
        res.status(400).json({
            error: "Failed to create channel: " + (channelError.message || "Unknown error")
        });
        return
    }
}

export const addBotToChannel = async(req: Request, res: Response) => {
    const { channelId, botUsername } = req.body;
    const userId = req.userId;
    
    if(!channelId || !botUsername) {
        res.status(400).json({
            error: "Channel ID and bot username are required"
        });
        return;
    }
    
    // Validate bot username format
    if(!botUsername.startsWith('@')) {
        res.status(400).json({
            error: "Bot username must start with @"
        });
        return;
    }
    
    // Get user data with session
    const user = await prismaClient.user.findUnique({
        where: {
            id: userId
        }
    });
    
    if(!user || !user.session || user.authenticated !== true) {
        res.status(400).json({
            error: "Please verify your Telegram account first"
        });
        return;
    }
    
    // Get channel info to make sure user owns it
    const channel = await prismaClient.channel.findFirst({
        where: {
            id: channelId,
            ownerId: userId
        }
    });
    
    if(!channel) {
        res.status(403).json({
            error: "Channel not found or you don't have permission"
        });
        return;
    }
    
    // Create client with saved session
    const stringSession = new StringSession(user.session);
    const client = new TelegramClient(stringSession, Number(process.env.API_ID), process.env.API_HASH || '', { 
        connectionRetries: 5 
    });
    await client.connect();
    // Check if user is logged in
    if(!await client.isUserAuthorized()) {
        res.status(401).json({
            error: "User not authorized on Telegram"
        });
        return;
    }
    
    try {
        console.log("Starting bot addition process...");
        
        // First resolve the bot username to get full entity info
        const resolveResult = await client.invoke(
            new Api.contacts.ResolveUsername({
                username: botUsername.replace('@', '')
            })
        );

        console.log("Bot resolution result:", JSON.stringify(resolveResult, null, 2));

        if (!resolveResult || !resolveResult.users || resolveResult.users.length === 0) {
            res.status(404).json({
                error: "Bot not found. Please check the username."
            });
            return;
        }

        const botUser = resolveResult.users[0];
        console.log("Bot user details:", JSON.stringify(botUser, null, 2));
        
        // Create explicit InputUser for the bot
        const inputUser = new Api.InputUser({
            userId: botUser.id,
            accessHash: (botUser as any).accessHash
        });
        console.log("Created input user:", JSON.stringify(inputUser, null, 2));

        // Get the proper channel entity using channel username instead of telegramId
        // First, need to get the full dialogs list to find our channel
        console.log("Fetching dialogs to locate the channel...");
        const dialogs = await client.getDialogs({});
        console.log(`Found ${dialogs.length} dialogs`);
        
        // Find our channel by id in dialogs
        const targetChannelId = channel.telegramId;
        console.log("Looking for channel with ID:", targetChannelId);
        
        let targetChannel = null;
        for (const dialog of dialogs) {
            console.log("Dialog:", JSON.stringify({
                id: dialog.entity?.id,
                title: dialog.title,
                type: dialog.entity?.className
            }));
            
            if (dialog.entity && 
                (dialog.entity.id.toString() === targetChannelId || 
                 dialog.entity.id.toString() === `-100${targetChannelId}`)) {
                targetChannel = dialog.entity;
                break;
            }
        }
        
        if (!targetChannel) {
            res.status(404).json({
                error: "Channel not found in your dialogs. Make sure you have created it and it's accessible."
            });
            return;
        }
        
        console.log("Found channel:", JSON.stringify(targetChannel, null, 2));
        
        // Add bot as admin to the channel using explicit input user
        console.log("Adding bot as admin with ID:", botUser.id);
        const addBotResult = await client.invoke(
            new Api.channels.EditAdmin({
                channel: targetChannel,
                userId: inputUser,  // Use explicit InputUser
                adminRights: new Api.ChatAdminRights({
                    changeInfo: true,
                    postMessages: true,
                    editMessages: true,
                    deleteMessages: true,
                    banUsers: true,
                    inviteUsers: true,
                    pinMessages: true,
                    addAdmins: false,
                    anonymous: false,
                    manageCall: true,
                    other: true
                }),
                rank: "Channel Bot"
            })
        );
        console.log("Add bot result:", JSON.stringify(addBotResult, null, 2));

        if (!addBotResult) {
            res.status(400).json({
                error: "Failed to add bot as admin"
            });
            return;
        }

        // Update channel in database to mark bot as added
        const updatedChannel = await prismaClient.channel.update({
            where: {
                id: channel.id
            },
            data: {
                hasBot: true,
                botUsername: botUsername
            }
        });

        res.status(200).json({
            message: "Bot added as admin successfully",
            channel: updatedChannel
        });
    } catch (error: any) {
        console.log("Error adding bot to channel:", error);
        res.status(400).json({
            error: "Failed to add bot to channel: " + (error.message || "Unknown error")
        });
    }
}

export const listChannels = async(req: Request, res: Response) => {
    const userId = req.userId;
    
    // Get all channels owned by the user
    const channels = await prismaClient.channel.findMany({
        where: {
            ownerId: userId
        }
    });
    
    res.status(200).json({
        message: "Channels fetched successfully",
        channels: channels
    });
}       

export const addUserToChannel = async(req: Request, res: Response) => {
    const { channelId, username } = req.body;
    const userId = req.userId;
    
    if(!channelId || !username) {
        res.status(400).json({
            error: "Channel ID and username are required"
        });
        return;
    }
    
    // Get user data with session
    const user = await prismaClient.user.findUnique({
        where: {
            id: userId
        }
    });
    
    if(!user || !user.session || user.authenticated !== true) {
        res.status(400).json({
            error: "Please verify your Telegram account first"
        });
        return;
    }
    
    // Get channel info to make sure user owns it
    const channel = await prismaClient.channel.findFirst({
        where: {
            id: channelId,
            ownerId: userId
        }
    });
    
    if(!channel) {
        res.status(403).json({
            error: "Channel not found or you don't have permission"
        });
        return;
    }
    
    // Create client with saved session
    const stringSession = new StringSession(user.session);
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    
    try {
        console.log("Starting user addition process...");
        
        // First resolve the username to get full entity info
        const resolveResult = await client.invoke(
            new Api.contacts.ResolveUsername({
                username: username.replace('@', '')
            })
        );

        if (!resolveResult || !resolveResult.users || resolveResult.users.length === 0) {
            res.status(404).json({
                error: "User not found. Please check the username."
            });
            return;
        }

        const targetUser = resolveResult.users[0];
        
        // Create explicit InputUser
        const inputUser = new Api.InputUser({
            userId: targetUser.id,
            accessHash: (targetUser as any).accessHash
        });

        // Get the channel from dialogs
        const dialogs = await client.getDialogs({});
        let targetChannel = null;
        
        for (const dialog of dialogs) {
            if (dialog.entity && 
                (dialog.entity.id.toString() === channel.telegramId || 
                 dialog.entity.id.toString() === `-100${channel.telegramId}`)) {
                targetChannel = dialog.entity;
                break;
            }
        }
        
        if (!targetChannel) {
            res.status(404).json({
                error: "Channel not found in your dialogs"
            });
            return;
        }

        // Add user to the channel
        const addResult = await client.invoke(
            new Api.channels.InviteToChannel({
                channel: targetChannel,
                users: [inputUser]
            })
        );

        if (!addResult) {
            res.status(400).json({
                error: "Failed to add user to channel"
            });
            return;
        }

        res.status(200).json({
            message: "User added to channel successfully"
        });
    } catch (error: any) {
        console.log("Error adding user to channel:", error);
        res.status(400).json({
            error: "Failed to add user to channel: " + (error.message || "Unknown error")
        });
    }
}

export const removeUserFromChannel = async(req: Request, res: Response) => {
    const { channelId, username } = req.body;
    const userId = req.userId;
    
    if(!channelId || !username) {
        res.status(400).json({
            error: "Channel ID and username are required"
        });
        return;
    }
    
    // Get user data with session
    const user = await prismaClient.user.findUnique({
        where: {
            id: userId
        }
    });
    
    if(!user || !user.session || user.authenticated !== true) {
        res.status(400).json({
            error: "Please verify your Telegram account first"
        });
        return;
    }
    
    // Get channel info to make sure user owns it
    const channel = await prismaClient.channel.findFirst({
        where: {
            id: channelId,
            ownerId: userId
        }
    });
    
    if(!channel) {
        res.status(403).json({
            error: "Channel not found or you don't have permission"
        });
        return;
    }
    
    // Create client with saved session
    const stringSession = new StringSession(user.session);
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    
    try {
        console.log("Starting user removal process...");
        
        // First resolve the username to get full entity info
        const resolveResult = await client.invoke(
            new Api.contacts.ResolveUsername({
                username: username.replace('@', '')
            })
        );

        if (!resolveResult || !resolveResult.users || resolveResult.users.length === 0) {
            res.status(404).json({
                error: "User not found. Please check the username."
            });
            return;
        }

        const targetUser = resolveResult.users[0];
        
        // Create explicit InputUser
        const inputUser = new Api.InputUser({
            userId: targetUser.id,
            accessHash: (targetUser as any).accessHash
        });

        // Get the channel from dialogs
        const dialogs = await client.getDialogs({});
        let targetChannel = null;
        
        for (const dialog of dialogs) {
            if (dialog.entity && 
                (dialog.entity.id.toString() === channel.telegramId || 
                 dialog.entity.id.toString() === `-100${channel.telegramId}`)) {
                targetChannel = dialog.entity;
                break;
            }
        }
        
        if (!targetChannel) {
            res.status(404).json({
                error: "Channel not found in your dialogs"
            });
            return;
        }

        // Remove user from the channel
        const kickResult = await client.invoke(
            new Api.channels.EditBanned({
                channel: targetChannel,
                participant: inputUser,
                bannedRights: new Api.ChatBannedRights({
                    untilDate: 0,  // permanent
                    viewMessages: true,
                    sendMessages: true,
                    sendMedia: true,
                    sendStickers: true,
                    sendGifs: true,
                    sendGames: true,
                    sendInline: true,
                    embedLinks: true
                })
            })
        );

        if (!kickResult) {
            res.status(400).json({
                error: "Failed to remove user from channel"
            });
            return;
        }

        res.status(200).json({
            message: "User removed from channel successfully"
        });
    } catch (error: any) {
        console.log("Error removing user from channel:", error);
        res.status(400).json({
            error: "Failed to remove user from channel: " + (error.message || "Unknown error")
        });
    }
}

export const banUserFromChannel = async(req: Request, res: Response) => {
    const { channelId, username } = req.body;
    const userId = req.userId;
    
    if(!channelId || !username) {
        res.status(400).json({
            error: "Channel ID and username are required"
        });
        return;
    }
    
    // Get user data with session (we'll need user's session to access dialogs)
    const user = await prismaClient.user.findUnique({
        where: {
            id: userId
        }
    });
    
    if(!user || !user.session || user.authenticated !== true) {
        res.status(400).json({
            error: "Please verify your Telegram account first"
        });
        return;
    }
    
    // Get channel info to make sure user owns it
    const channel = await prismaClient.channel.findFirst({
        where: {
            id: channelId,
            ownerId: userId
        }
    });
    
    if(!channel) {
        res.status(403).json({
            error: "Channel not found or you don't have permission"
        });
        return;
    }
    
    // Check if bot is added to the channel
    if(!channel.hasBot || !channel.botUsername) {
        res.status(400).json({
            error: "Bot is not added to this channel. Please add the bot first."
        });
        return;
    }
    
    // First, use user's session to get proper channel entity
    const stringSession = new StringSession(user.session);
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    
    try {
        console.log("Starting bot-managed user ban process...");
        
        // First resolve the username to get full entity info
        const resolveResult = await client.invoke(
            new Api.contacts.ResolveUsername({
                username: username.replace('@', '')
            })
        );

        if (!resolveResult || !resolveResult.users || resolveResult.users.length === 0) {
            res.status(404).json({
                error: "User not found. Please check the username."
            });
            return;
        }

        const targetUser = resolveResult.users[0];
        
        // Create explicit InputUser for the target
        const inputUser = new Api.InputUser({
            userId: targetUser.id,
            accessHash: (targetUser as any).accessHash
        });

        // Get the channel from dialogs
        const dialogs = await client.getDialogs({});
        let targetChannel = null;
        
        for (const dialog of dialogs) {
            if (dialog.entity && 
                (dialog.entity.id.toString() === channel.telegramId || 
                 dialog.entity.id.toString() === `-100${channel.telegramId}`)) {
                targetChannel = dialog.entity;
                break;
            }
        }
        
        if (!targetChannel) {
            res.status(404).json({
                error: "Channel not found in your dialogs"
            });
            return;
        }
        
        console.log("Found channel and user info successfully.");

        // Now that we have found the entities properly, use the Bot API with Telegram IDs
        // Get the bot token from environment variables
        const botToken = process.env.BOT_TOKEN;
        if(!botToken) {
            res.status(500).json({
                error: "Bot token not configured"
            });
            return;
        }
        
        // Format the channel ID correctly for Telegram Bot API
        let formattedChannelId;
        if (targetChannel.id.toString().startsWith('-')) {
            formattedChannelId = targetChannel.id.toString();
        } else {
            formattedChannelId = `-100${targetChannel.id}`;
        }
        
        console.log("Using channel ID:", formattedChannelId);
        console.log("User ID to ban:", targetUser.id.toString());
        
        // Ban the user using Bot API
        const banUrl = `https://api.telegram.org/bot${botToken}/banChatMember`;
        const response = await fetch(banUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: formattedChannelId,
                user_id: targetUser.id.toString(),
                revoke_messages: false
            })
        });
        
        const result = await response.json();
        console.log("Ban API response:", result);
        
        if(!result.ok) {
            // If Bot API fails, fall back to user's client
            console.log("Bot API failed, falling back to user client method");
            
            const banResult = await client.invoke(
                new Api.channels.EditBanned({
                    channel: targetChannel,
                    participant: inputUser,
                    bannedRights: new Api.ChatBannedRights({
                        untilDate: 0,  // permanent ban (0 means forever)
                        viewMessages: true,
                        sendMessages: true,
                        sendMedia: true,
                        sendStickers: true,
                        sendGifs: true,
                        sendGames: true,
                        sendInline: true,
                        embedLinks: true,
                        sendPolls: true,
                        changeInfo: true,
                        inviteUsers: true,
                        pinMessages: true
                    })
                })
            );
            
            if (!banResult) {
                res.status(400).json({
                    error: "Failed to ban user from channel using both methods"
                });
                return;
            }
        }
        
        res.status(200).json({
            message: "User banned from channel successfully"
        });
    } catch (error: any) {
        console.log("Error banning user from channel:", error);
        res.status(400).json({
            error: "Failed to ban user from channel: " + (error.message || "Unknown error")
        });
    }
}

export const unbanUserFromChannel = async(req: Request, res: Response) => {
    const { channelId, username } = req.body;
    const userId = req.userId;
    
    if(!channelId || !username) {
        res.status(400).json({
            error: "Channel ID and username are required"
        });
        return;
    }
    
    // Get user data with session (we'll need user's session to access dialogs)
    const user = await prismaClient.user.findUnique({
        where: {
            id: userId
        }
    });
    
    if(!user || !user.session || user.authenticated !== true) {
        res.status(400).json({
            error: "Please verify your Telegram account first"
        });
        return;
    }
    
    // Get channel info to make sure user owns it
    const channel = await prismaClient.channel.findFirst({
        where: {
            id: channelId,
            ownerId: userId
        }
    });
    
    if(!channel) {
        res.status(403).json({
            error: "Channel not found or you don't have permission"
        });
        return;
    }
    
    // Check if bot is added to the channel
    if(!channel.hasBot || !channel.botUsername) {
        res.status(400).json({
            error: "Bot is not added to this channel. Please add the bot first."
        });
        return;
    }
    
    // First, use user's session to get proper channel entity
    const stringSession = new StringSession(user.session);
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    
    try {
        console.log("Starting bot-managed user unban process...");
        
        // First resolve the username to get full entity info
        const resolveResult = await client.invoke(
            new Api.contacts.ResolveUsername({
                username: username.replace('@', '')
            })
        );

        if (!resolveResult || !resolveResult.users || resolveResult.users.length === 0) {
            res.status(404).json({
                error: "User not found. Please check the username."
            });
            return;
        }

        const targetUser = resolveResult.users[0];
        
        // Create explicit InputUser for the target
        const inputUser = new Api.InputUser({
            userId: targetUser.id,
            accessHash: (targetUser as any).accessHash
        });

        // Get the channel from dialogs
        const dialogs = await client.getDialogs({});
        let targetChannel = null;
        
        for (const dialog of dialogs) {
            if (dialog.entity && 
                (dialog.entity.id.toString() === channel.telegramId || 
                 dialog.entity.id.toString() === `-100${channel.telegramId}`)) {
                targetChannel = dialog.entity;
                break;
            }
        }
        
        if (!targetChannel) {
            res.status(404).json({
                error: "Channel not found in your dialogs"
            });
            return;
        }
        
        console.log("Found channel and user info successfully.");

        // Now that we have found the entities properly, use the Bot API with Telegram IDs
        // Get the bot token from environment variables
        const botToken = process.env.BOT_TOKEN;
        if(!botToken) {
            res.status(500).json({
                error: "Bot token not configured"
            });
            return;
        }
        
        // Format the channel ID correctly for Telegram Bot API
        let formattedChannelId;
        if (targetChannel.id.toString().startsWith('-')) {
            formattedChannelId = targetChannel.id.toString();
        } else {
            formattedChannelId = `-100${targetChannel.id}`;
        }
        
        console.log("Using channel ID:", formattedChannelId);
        console.log("User ID to unban:", targetUser.id.toString());
        
        // Unban the user using Bot API
        const unbanUrl = `https://api.telegram.org/bot${botToken}/unbanChatMember`;
        const response = await fetch(unbanUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: formattedChannelId,
                user_id: targetUser.id.toString(),
                only_if_banned: true
            })
        });
        
        const result = await response.json();
        console.log("Unban API response:", result);
        
        if(!result.ok) {
            // If Bot API fails, fall back to user's client
            console.log("Bot API failed, falling back to user client method");
            
            const unbanResult = await client.invoke(
                new Api.channels.EditBanned({
                    channel: targetChannel,
                    participant: inputUser,
                    bannedRights: new Api.ChatBannedRights({
                        untilDate: 0,
                        viewMessages: false,
                        sendMessages: false,
                        sendMedia: false,
                        sendStickers: false,
                        sendGifs: false,
                        sendGames: false,
                        sendInline: false,
                        embedLinks: false,
                        sendPolls: false,
                        changeInfo: false,
                        inviteUsers: false,
                        pinMessages: false
                    })
                })
            );
            
            if (!unbanResult) {
                res.status(400).json({
                    error: "Failed to unban user from channel using both methods"
                });
                return;
            }
        }
        
        res.status(200).json({
            message: "User unbanned from channel successfully. They can now be added back or join with an invite link."
        });
    } catch (error: any) {
        console.log("Error unbanning user from channel:", error);
        res.status(400).json({
            error: "Failed to unban user from channel: " + (error.message || "Unknown error")
        });
    }
}