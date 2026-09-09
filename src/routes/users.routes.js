// src/routes/users.routes.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @route   GET /api/users/profile/:userId
 * @desc    Get user profile
 * @access  Private
 */
router.get('/profile/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        profilePicture: true,
        bio: true,
        role: true,
        address: true,
        city: true,
        latitude: true,
        longitude: true,
        yearsOfExperience: true,
        qualifications: true,
        specializations: true,
        hourlyRate: true,
        averageRating: true,
        totalReviews: true,
        businessName: true,
        companyLogo: true,
        isVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch profile', message: error.message });
  }
});

/**
 * @route   PUT /api/users/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put(
  '/profile',
  verifyToken,
  [
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('bio').optional().trim(),
    body('profilePicture').optional().isURL(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const updates = {};
      const allowedFields = [
        'firstName',
        'lastName',
        'bio',
        'profilePicture',
        'yearsOfExperience',
        'qualifications',
        'specializations',
        'hourlyRate',
        'businessName',
        'companyLogo',
      ];

      allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      });

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: updates,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          bio: true,
          profilePicture: true,
        },
      });

      res.status(200).json({ message: 'Profile updated successfully', user });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update profile', message: error.message });
    }
  }
);

/**
 * @route   GET /api/users/workers
 * @desc    Get all available workers (paginated)
 * @access  Private
 */
router.get('/workers', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, city = 'Vaal', specialization = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const workers = await prisma.user.findMany({
      where: {
        role: 'WORKER',
        isActive: true,
        isVerified: true,
        city: city,
        ...(specialization && { specializations: { has: specialization } }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        specializations: true,
        hourlyRate: true,
        averageRating: true,
        totalReviews: true,
        yearsOfExperience: true,
        address: true,
        latitude: true,
        longitude: true,
      },
      skip,
      take: parseInt(limit),
      orderBy: { averageRating: 'desc' },
    });

    const total = await prisma.user.count({
      where: {
        role: 'WORKER',
        isActive: true,
        isVerified: true,
        city: city,
      },
    });

    res.status(200).json({
      workers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch workers', message: error.message });
  }
});

/**
 * @route   GET /api/users/workers/:workerId/reviews
 * @desc    Get reviews for a specific worker
 * @access  Private
 */
router.get('/workers/:workerId/reviews', verifyToken, async (req, res) => {
  try {
    const { workerId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await prisma.review.findMany({
      where: { recipientId: workerId },
      include: {
        author: {
          select: {
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
      },
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.review.count({ where: { recipientId: workerId } });

    res.status(200).json({
      reviews,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch reviews', message: error.message });
  }
});

module.exports = router;
