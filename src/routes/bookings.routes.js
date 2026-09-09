// src/routes/bookings.routes.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const { generateBookingNumber } = require('../utils/helpers');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @route   POST /api/bookings
 * @desc    Create a new booking (Employer only)
 * @access  Private
 */
router.post(
  '/',
  verifyToken,
  verifyRole(['EMPLOYER']),
  [
    body('serviceCategory').notEmpty(),
    body('title').notEmpty().trim(),
    body('description').notEmpty().trim(),
    body('estimatedDuration').isInt({ min: 15 }),
    body('estimatedCost').isFloat({ min: 0 }),
    body('serviceAddress').notEmpty(),
    body('scheduledDate').isISO8601(),
    body('scheduledTime').matches(/^\d{2}:\d{2}$/),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        serviceCategory,
        title,
        description,
        estimatedDuration,
        estimatedCost,
        serviceAddress,
        city,
        latitude,
        longitude,
        scheduledDate,
        scheduledTime,
        specialRequests,
        images,
      } = req.body;

      const booking = await prisma.booking.create({
        data: {
          bookingNumber: generateBookingNumber(),
          employerId: req.user.id,
          serviceCategory,
          title,
          description,
          estimatedDuration,
          estimatedCost,
          serviceAddress,
          city: city || 'Vaal',
          latitude,
          longitude,
          scheduledDate: new Date(scheduledDate),
          scheduledTime,
          specialRequests,
          images: images || [],
          status: 'PENDING',
        },
        include: {
          employer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
              phoneNumber: true,
            },
          },
        },
      });

      // Create notification for available workers
      // TODO: Implement push notifications

      res.status(201).json({
        message: 'Booking created successfully',
        booking,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to create booking', message: error.message });
    }
  }
);

/**
 * @route   GET /api/bookings
 * @desc    Get bookings (Worker: pending/assigned, Employer: all their bookings)
 * @access  Private
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = {};

    if (req.user.role === 'WORKER') {
      // Workers see bookings assigned to them
      whereClause = {
        workerId: req.user.id,
      };
    } else if (req.user.role === 'EMPLOYER') {
      // Employers see their own bookings
      whereClause = {
        employerId: req.user.id,
      };
    }

    if (status && ['PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(status)) {
      whereClause.status = status;
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        employer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            phoneNumber: true,
          },
        },
        worker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            phoneNumber: true,
            averageRating: true,
          },
        },
      },
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.booking.count({ where: whereClause });

    res.status(200).json({
      bookings,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch bookings', message: error.message });
  }
});

/**
 * @route   GET /api/bookings/:bookingId
 * @desc    Get booking details
 * @access  Private
 */
router.get('/:bookingId', verifyToken, async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        employer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            phoneNumber: true,
            email: true,
            businessName: true,
          },
        },
        worker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            phoneNumber: true,
            email: true,
            averageRating: true,
            specializations: true,
          },
        },
        reviews: true,
        payment: true,
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify access (employer or assigned worker)
    if (req.user.id !== booking.employerId && req.user.id !== booking.workerId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.status(200).json({ booking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch booking', message: error.message });
  }
});

/**
 * @route   PUT /api/bookings/:bookingId
 * @desc    Update booking details (before acceptance)
 * @access  Private (Employer only)
 */
router.put(
  '/:bookingId',
  verifyToken,
  verifyRole(['EMPLOYER']),
  async (req, res) => {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });

      if (!booking) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      if (booking.employerId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (booking.status !== 'PENDING') {
        return res.status(400).json({ error: 'Can only edit pending bookings' });
      }

      const updates = {};
      const allowedFields = [
        'title',
        'description',
        'estimatedDuration',
        'estimatedCost',
        'scheduledDate',
        'scheduledTime',
        'specialRequests',
      ];

      allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      });

      const updatedBooking = await prisma.booking.update({
        where: { id: bookingId },
        data: updates,
        include: {
          employer: {
            select: { firstName: true, lastName: true, phoneNumber: true },
          },
        },
      });

      res.status(200).json({
        message: 'Booking updated successfully',
        booking: updatedBooking,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update booking', message: error.message });
    }
  }
);

/**
 * @route   POST /api/bookings/:bookingId/accept
 * @desc    Accept a booking (Worker only)
 * @access  Private
 */
router.post('/:bookingId/accept', verifyToken, verifyRole(['WORKER']), async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.status !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending bookings can be accepted' });
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        workerId: req.user.id,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
      include: {
        employer: { select: { id: true, email: true, firstName: true } },
        worker: { select: { id: true, email: true, firstName: true } },
      },
    });

    // TODO: Send notification to employer

    res.status(200).json({
      message: 'Booking accepted successfully',
      booking: updatedBooking,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to accept booking', message: error.message });
  }
});

/**
 * @route   POST /api/bookings/:bookingId/reject
 * @desc    Reject a pending booking (Worker only)
 * @access  Private
 */
router.post('/:bookingId/reject', verifyToken, verifyRole(['WORKER']), async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.status !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending bookings can be rejected' });
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'REJECTED',
        notes: reason || 'Rejected by worker',
      },
    });

    // TODO: Notify employer and reopen for other workers

    res.status(200).json({
      message: 'Booking rejected',
      booking: updatedBooking,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to reject booking', message: error.message });
  }
});

/**
 * @route   POST /api/bookings/:bookingId/complete
 * @desc    Mark booking as completed (Worker only)
 * @access  Private
 */
router.post('/:bookingId/complete', verifyToken, verifyRole(['WORKER']), async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { notes, images } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.workerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (booking.status !== 'ACCEPTED') {
      return res.status(400).json({ error: 'Only accepted bookings can be completed' });
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        notes: notes || booking.notes,
        images: images || booking.images,
      },
    });

    // TODO: Update worker rating, send notification to employer

    res.status(200).json({
      message: 'Booking marked as completed',
      booking: updatedBooking,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to complete booking', message: error.message });
  }
});

/**
 * @route   POST /api/bookings/:bookingId/cancel
 * @desc    Cancel a booking (Employer only)
 * @access  Private
 */
router.post('/:bookingId/cancel', verifyToken, verifyRole(['EMPLOYER']), async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.employerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (booking.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel completed bookings' });
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        notes: reason || 'Cancelled by employer',
      },
    });

    // TODO: Handle refunds, notify worker

    res.status(200).json({
      message: 'Booking cancelled',
      booking: updatedBooking,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to cancel booking', message: error.message });
  }
});

/**
 * @route   GET /api/bookings/pending
 * @desc    Get pending bookings for workers (similar to job listings)
 * @access  Private (Worker only)
 */
router.get(
  '/pending',
  verifyToken,
  verifyRole(['WORKER']),
  async (req, res) => {
    try {
      const { page = 1, limit = 10, serviceCategory, city } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const worker = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { specializations: true, city: true },
      });

      const whereClause = {
        status: 'PENDING',
        city: city || worker.city,
        ...(serviceCategory && { serviceCategory }),
      };

      const bookings = await prisma.booking.findMany({
        where: whereClause,
        include: {
          employer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
              averageRating: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      });

      const total = await prisma.booking.count({ where: whereClause });

      res.status(200).json({
        bookings,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch pending bookings', message: error.message });
    }
  }
);

module.exports = router;
