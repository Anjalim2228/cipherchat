import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message';
import User from '../models/User';
import Group from '../models/Group';

// Store online users: userId -> socketId
const onlineUsers = new Map<string, string>();

export const initializeSocket = (io: Server) => {

  // Middleware - verify JWT before connection
  io.use(async (socket: any, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET as string
      ) as { userId: string };

      const user = await User.findById(decoded.userId).select('-password');
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = decoded.userId;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket: any) => {
    const userId = socket.userId;
    console.log(`✅ User connected: ${socket.user.username} (${socket.id})`);

    // Add to online users
    onlineUsers.set(userId, socket.id);

    // Update user online status in DB
    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });

    // Broadcast online users list to everyone
    io.emit('onlineUsers', Array.from(onlineUsers.keys()));

    // ─── Join all group rooms this user belongs to ──
    const userGroups = await Group.find({ members: userId });
    userGroups.forEach((group) => {
      socket.join(`group:${group._id}`);
    });

    // ─── Send Direct Message ────────────────────────
    socket.on('sendMessage', async (data: {
      receiverId: string;
      message: string;
    }) => {
      try {
        const newMessage = await Message.create({
          sender: userId,
          receiver: data.receiverId,
          message: data.message,
          messageType: 'text',
        });

        const populatedMessage = await Message.findById(newMessage._id)
          .populate('sender', 'username avatar')
          .populate('receiver', 'username avatar');

        const receiverSocketId = onlineUsers.get(data.receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receiveMessage', populatedMessage);
        }

        socket.emit('messageSent', populatedMessage);

      } catch (error) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ─── Send Group Message ─────────────────────────
    socket.on('sendGroupMessage', async (data: {
      groupId: string;
      message: string;
    }) => {
      try {
        // Verify user is a member of this group
        const group = await Group.findById(data.groupId);
        if (!group) {
          socket.emit('error', { message: 'Group not found' });
          return;
        }

        const isMember = group.members.some(
          (memberId) => memberId.toString() === userId
        );
        if (!isMember) {
          socket.emit('error', { message: 'You are not a member of this group' });
          return;
        }

        // Save message to DB
        const newMessage = await Message.create({
          sender: userId,
          group: data.groupId,
          message: data.message,
          messageType: 'text',
        });

        const populatedMessage = await Message.findById(newMessage._id)
          .populate('sender', 'username avatar')
          .populate('group', 'name');

        // Emit to all members in the group room (including sender)
        io.to(`group:${data.groupId}`).emit('receiveGroupMessage', populatedMessage);

      } catch (error) {
        socket.emit('error', { message: 'Failed to send group message' });
      }
    });

    // ─── Join Group Room (when group is created/user added) ─
    socket.on('joinGroup', (data: { groupId: string }) => {
      socket.join(`group:${data.groupId}`);
    });

    // ─── Typing Indicator (DM) ──────────────────────
    socket.on('typing', (data: { receiverId: string }) => {
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('userTyping', {
          userId,
          username: socket.user.username,
        });
      }
    });

    // ─── Stop Typing (DM) ──────────────────────────
    socket.on('stopTyping', (data: { receiverId: string }) => {
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('userStopTyping', { userId });
      }
    });

    // ─── Typing Indicator (Group) ───────────────────
    socket.on('groupTyping', (data: { groupId: string }) => {
      socket.to(`group:${data.groupId}`).emit('groupUserTyping', {
        userId,
        username: socket.user.username,
        groupId: data.groupId,
      });
    });

    // ─── Stop Typing (Group) ───────────────────────
    socket.on('groupStopTyping', (data: { groupId: string }) => {
      socket.to(`group:${data.groupId}`).emit('groupUserStopTyping', {
        userId,
        groupId: data.groupId,
      });
    });

    // ─── Mark Messages as Read ─────────────────────
    socket.on('markAsRead', async (data: { senderId: string }) => {
      await Message.updateMany(
        { sender: data.senderId, receiver: userId, isRead: false },
        { isRead: true }
      );

      const senderSocketId = onlineUsers.get(data.senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit('messagesRead', { by: userId });
      }
    });

    // ─── Disconnect ────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${socket.user.username}`);
      onlineUsers.delete(userId);

      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date(),
      });

      io.emit('onlineUsers', Array.from(onlineUsers.keys()));
    });
  });
};