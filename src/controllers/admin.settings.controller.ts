import { Request, Response } from 'express';
import { ExamPurchase } from '../models/exam-purchase.model';
import { UserSubscription } from '../models/subscription.model';
import FeatureFlag from '../models/feature-flag.model';
import SystemConfig from '../models/system-config.model';
import { logger } from '../lib/logger';

export const getPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const [purchases, subscriptions] = await Promise.all([
      ExamPurchase.find().populate('userId', 'name email').populate('examId', 'title price'),
      UserSubscription.find().populate('planId', 'name price'),
    ]);

    logger.info({ adminId: req.user?.id, purchases: purchases.length, subscriptions: subscriptions.length }, 'Admin payments fetched');
    res.status(200).json({
      success: true,
      data: {
        purchases,
        subscriptions,
      },
    });
  } catch (error) {
    logger.error({ error, adminId: req.user?.id }, 'Failed to fetch payments');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const getFeatureFlags = async (req: Request, res: Response): Promise<void> => {
  try {
    const flags = await FeatureFlag.find();
    logger.info({ adminId: req.user?.id, count: flags.length }, 'Feature flags fetched');
    res.status(200).json({ success: true, count: flags.length, data: flags });
  } catch (error) {
    logger.error({ error, adminId: req.user?.id }, 'Failed to fetch feature flags');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const toggleFeatureFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const flag = await FeatureFlag.findById(id);

    if (!flag) {
      logger.warn({ flagId: id, adminId: req.user?.id }, 'Feature flag not found');
      res.status(404).json({ success: false, message: 'Feature flag not found' });
      return;
    }

    flag.enabled = !flag.enabled;
    await flag.save();

    logger.info({ flagId: id, adminId: req.user?.id, enabled: flag.enabled }, 'Feature flag toggled');
    res.status(200).json({
      success: true,
      message: `Feature flag ${flag.enabled ? 'enabled' : 'disabled'}`,
      data: flag,
    });
  } catch (error) {
    logger.error({ error, flagId: req.params.id, adminId: req.user?.id }, 'Failed to toggle feature flag');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const createFeatureFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { key, name, description, category } = req.body;

    const existing = await FeatureFlag.findOne({ key });
    if (existing) {
      logger.warn({ key, adminId: req.user?.id }, 'Duplicate feature flag key');
      res.status(400).json({ success: false, message: 'Feature flag with this key already exists' });
      return;
    }

    const flag = await FeatureFlag.create({
      key,
      name,
      description,
      category: category || 'system',
      enabled: false,
    });

    logger.info({ flagId: flag._id, adminId: req.user?.id, key }, 'Feature flag created');
    res.status(201).json({
      success: true,
      message: 'Feature flag created successfully',
      data: flag,
    });
  } catch (error) {
    logger.error({ error, adminId: req.user?.id }, 'Failed to create feature flag');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const updateFeatureFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { key, name, description, category, enabled } = req.body;

    const updateFields: any = {};
    if (key !== undefined) updateFields.key = key;
    if (name !== undefined) updateFields.name = name;
    if (description !== undefined) updateFields.description = description;
    if (category !== undefined) updateFields.category = category;
    if (enabled !== undefined) updateFields.enabled = enabled;

    const flag = await FeatureFlag.findByIdAndUpdate(id, updateFields, { new: true });

    if (!flag) {
      logger.warn({ flagId: id, adminId: req.user?.id }, 'Feature flag not found for update');
      res.status(404).json({ success: false, message: 'Feature flag not found' });
      return;
    }

    logger.info({ flagId: id, adminId: req.user?.id, updates: updateFields }, 'Feature flag updated');
    res.status(200).json({
      success: true,
      message: 'Feature flag updated successfully',
      data: flag,
    });
  } catch (error) {
    logger.error({ error, flagId: req.params.id, adminId: req.user?.id }, 'Failed to update feature flag');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const deleteFeatureFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const flag = await FeatureFlag.findByIdAndDelete(id);

    if (!flag) {
      logger.warn({ flagId: id, adminId: req.user?.id }, 'Feature flag not found for deletion');
      res.status(404).json({ success: false, message: 'Feature flag not found' });
      return;
    }

    logger.info({ flagId: id, adminId: req.user?.id }, 'Feature flag deleted');
    res.status(200).json({
      success: true,
      message: 'Feature flag deleted successfully',
      data: { id },
    });
  } catch (error) {
    logger.error({ error, flagId: req.params.id, adminId: req.user?.id }, 'Failed to delete feature flag');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const getSystemConfigs = async (req: Request, res: Response): Promise<void> => {
  try {
    const configs = await SystemConfig.find();
    logger.info({ adminId: req.user?.id, count: configs.length }, 'System configs fetched');
    res.status(200).json({ success: true, count: configs.length, data: configs });
  } catch (error) {
    logger.error({ error, adminId: req.user?.id }, 'Failed to fetch system configs');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const updateSystemConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const config = await SystemConfig.findOneAndUpdate(
      { key },
      { value },
      { new: true, upsert: true }
    );

    logger.info({ configKey: key, adminId: req.user?.id }, 'System config updated');
    res.status(200).json({
      success: true,
      message: 'System configuration updated successfully',
      data: config,
    });
  } catch (error) {
    logger.error({ error, configKey: req.params.key, adminId: req.user?.id }, 'Failed to update system config');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};