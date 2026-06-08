import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message';
import User from '../models/User';

const onlineUsers = new Map<string, string>();

export const initializeSocket = (io: Server) => {

  io.use(async (socket: any, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string };
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) return next(new Error('User not found'));
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

    onlineUsers.set(userId, socket.id);
    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
    io.emit('onlineUsers', Array.from(onlineUsers.keys()));

    // ─── Send Message ──────────────────────────────
    socket.on('sendMessage', async (data: { receiverId: string; message: string }) => {
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
        if (receiverSocketId) io.to(receiverSocketId).emit('receiveMessage', populatedMessage);
        socket.emit('messageSent', populatedMessage);
      } catch (error) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ─── Typing ────────────────────────────────────
    socket.on('typing', (data: { receiverId: string }) => {
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) io.to(receiverSocketId).emit('userTyping', { userId, username: socket.user.username });
    });

    socket.on('stopTyping', (data: { receiverId: string }) => {
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) io.to(receiverSocketId).emit('userStopTyping', { userId });
    });

    socket.on('markAsRead', async (data: { senderId: string }) => {
      await Message.updateMany({ sender: data.senderId, receiver: userId, isRead: false }, { isRead: true });
      const senderSocketId = onlineUsers.get(data.senderId);
      if (senderSocketId) io.to(senderSocketId).emit('messagesRead', { by: userId });
    });

    // ════════════════════════════════════════════════
    // ─── WebRTC CALLING (Real-time) ─────────────────
    // ════════════════════════════════════════════════

    // Caller sends call-offer to callee
    socket.on('call:offer', (data: {
      toUserId: string;
      offer: any;
      callType: 'audio' | 'video';
      callerName: string;
    }) => {
      const receiverSocketId = onlineUsers.get(data.toUserId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('call:incoming', {
          fromUserId: userId,
          callerName: socket.user.username,
          offer: data.offer,
          callType: data.callType,
        });
      } else {
        // Target user is offline
        socket.emit('call:rejected', { reason: 'User is offline' });
      }
    });

    // Callee accepts — sends answer back to caller
    socket.on('call:answer', (data: {
      toUserId: string;
      answer: any;
    }) => {
      const callerSocketId = onlineUsers.get(data.toUserId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call:answered', {
          fromUserId: userId,
          answer: data.answer,
        });
      }
    });

    // ICE candidate exchange (both sides)
    socket.on('call:ice-candidate', (data: {
      toUserId: string;
      candidate: any;
    }) => {
      const targetSocketId = onlineUsers.get(data.toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ice-candidate', {
          fromUserId: userId,
          candidate: data.candidate,
        });
      }
    });

    // Callee rejects call
    socket.on('call:reject', (data: { toUserId: string }) => {
      const callerSocketId = onlineUsers.get(data.toUserId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call:rejected', {
          fromUserId: userId,
          reason: 'Call declined',
        });
      }
    });

    // Either side ends/hangs up
    socket.on('call:end', (data: { toUserId: string }) => {
      const targetSocketId = onlineUsers.get(data.toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ended', { fromUserId: userId });
      }
    });

    // ─── Disconnect ───────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${socket.user.username}`);
      onlineUsers.delete(userId);
      await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
      io.emit('onlineUsers', Array.from(onlineUsers.keys()));
    });
  });
};