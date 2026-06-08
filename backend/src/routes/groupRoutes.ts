import { Router, Response } from 'express';
import { protect, AuthRequest } from '../middleware/authMiddleware';
import Group from '../models/Group';
import Message from '../models/Message';

const router = Router();

// ─── Create Group ───────────────────────────────────────
// POST /api/groups/create
router.post('/create', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, memberIds } = req.body;
    const adminId = req.user._id;

    if (!name || !memberIds || memberIds.length === 0) {
      res.status(400).json({ message: 'Group name and at least one member required' });
      return;
    }

    // Always include admin in members
    const allMembers = [...new Set([adminId.toString(), ...memberIds])];

    const group = await Group.create({
      name,
      description: description || '',
      admin: adminId,
      members: allMembers,
    });

    const populatedGroup = await Group.findById(group._id)
      .populate('admin', 'username email')
      .populate('members', 'username email');

    res.status(201).json({ message: 'Group created successfully', group: populatedGroup });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create group' });
  }
});

// ─── Get My Groups ──────────────────────────────────────
// GET /api/groups
router.get('/', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user._id;

    const groups = await Group.find({ members: userId })
      .populate('admin', 'username email')
      .populate('members', 'username email')
      .sort({ updatedAt: -1 });

    res.status(200).json({ groups });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch groups' });
  }
});

// ─── Get Group Messages ─────────────────────────────────
// GET /api/groups/:groupId/messages
router.get('/:groupId/messages', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;

    // Check if user is a member
    const group = await Group.findById(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const isMember = group.members.some(
      (memberId) => memberId.toString() === userId.toString()
    );
    if (!isMember) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    const messages = await Message.find({ group: groupId })
      .populate('sender', 'username avatar')
      .sort({ createdAt: 1 });

    res.status(200).json({ messages });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch group messages' });
  }
});

// ─── Add Member to Group ────────────────────────────────
// POST /api/groups/:groupId/add-member
router.post('/:groupId/add-member', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const { userId: newMemberId } = req.body;
    const requesterId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    // Only admin can add members
    if (group.admin.toString() !== requesterId.toString()) {
      res.status(403).json({ message: 'Only admin can add members' });
      return;
    }

    // Check if already a member
    if (group.members.some((m) => m.toString() === newMemberId)) {
      res.status(400).json({ message: 'User is already a member' });
      return;
    }

    group.members.push(newMemberId);
    await group.save();

    const updatedGroup = await Group.findById(groupId)
      .populate('admin', 'username email')
      .populate('members', 'username email');

    res.status(200).json({ message: 'Member added', group: updatedGroup });
  } catch (error) {
    res.status(500).json({ message: 'Failed to add member' });
  }
});

// ─── Leave Group ────────────────────────────────────────
// POST /api/groups/:groupId/leave
router.post('/:groupId/leave', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    // Admin cannot leave — must delete group
    if (group.admin.toString() === userId.toString()) {
      res.status(400).json({ message: 'Admin cannot leave. Delete the group instead.' });
      return;
    }

    group.members = group.members.filter(
      (m) => m.toString() !== userId.toString()
    ) as any;
    await group.save();

    res.status(200).json({ message: 'Left group successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to leave group' });
  }
});

// ─── Delete Group ───────────────────────────────────────
// DELETE /api/groups/:groupId
router.delete('/:groupId', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    if (group.admin.toString() !== userId.toString()) {
      res.status(403).json({ message: 'Only admin can delete the group' });
      return;
    }

    await Group.findByIdAndDelete(groupId);
    await Message.deleteMany({ group: groupId });

    res.status(200).json({ message: 'Group deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete group' });
  }
});

export default router;