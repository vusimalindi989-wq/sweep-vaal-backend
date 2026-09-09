// src/routes/reviews.routes.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @route   POST /api/reviews
 * @desc    Create a review for a completed booking
 * @access  Private
 */
router.post(
  '/',
  verifyToken,
  [
    body('bookingId').notEmpty(),
    body('recipientId').notEmpty(),
    body('rating').isInt({ min: 1, max: 5 }),
    body('comment').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { bookingId, recipientId, rating, comment } = req.body;

      // Verify booking exists and is completed
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });

      if (!booking || booking.status !== 'COMPLETED') {
        return res.status(400).json({ error: 'Can only review completed bookings' });
      }

      // Check if review already exists
      const existingReview = await prisma.review.findUnique({
        where: { bookingId },
      });

      if (existingReview) {
        return res.status(409).json({ error: 'Review already exists for this booking' });
      }

      const review = await prisma.review.create({
        data: {
          bookingId,
          authorId: req.user.id,
          recipientId,
          rating,
          comment,
        },
        include: {
          author: {
            select: {
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
          booking: {
            select: {
              title: true,
              serviceCategory: true,
            },
          },
        },
      });

      // Update recipient's average rating
      const reviews = await prisma.review.findMany({
        where: { recipientId },
      });

      const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

      await prisma.user.update({
        where: { id: recipientId },
        data: {
          averageRating: avgRating,
          totalReviews: reviews.length,
        },
      });

      res.status(201).json({
        message: 'Review created successfully',
        review,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to create review', message: error.message });
    }
  }
);

/**
 * @route   GET /api/reviews/:userId
 * @desc    Get all reviews for a user
 * @access  Public
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await prisma.review.findMany({
      where: { recipientId: userId },
      include: {
        author: {
          select: {
            id: true,
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

    const total = await prisma.review.count({ where: { recipientId: userId } });

    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    res.status(200).json({
      reviews,
      stats: {
        totalReviews: total,
        averageRating: avgRating.toFixed(1),
      },
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
