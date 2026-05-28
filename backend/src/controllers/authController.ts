import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

// ─── Generate JWT Token ────────────────────────────────
const generateToken = (userId: string): string => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' } as jwt.SignOptions
  );
};

// ─── Register ─────────────────────────────────────────
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body;

    // 1. Check if all fields are provided
    if (!username || !email || !password) {
      res.status(400).json({ message: 'All fields are required' });
      return;
    }

    // 2. Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      res.status(400).json({ message: 'User already exists' });
      return;
    }

    // 3. Create new user (password hashing happens in User model)
    const user = await User.create({ username, email, password });

    // 4. Generate token
    const token = generateToken(user._id.toString());

    // 5. Send response
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

// ─── Login ────────────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // 1. Check if fields are provided
    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }

    // 2. Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    // 3. Compare password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    // 4. Generate token
    const token = generateToken(user._id.toString());

    // 5. Send response
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};