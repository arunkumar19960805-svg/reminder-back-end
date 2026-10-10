import User from '../modules/auth/user.model';
import RefreshToken from '../modules/auth/refresh-token.model';
import Event from '../modules/events/event.model';
import EventAssignment from '../modules/events/event-assignment.model';
import ReminderRule from '../modules/reminders/reminder-rule.model';
import ReminderInstance from '../modules/reminders/reminder-instance.model';
import Acknowledgement from '../modules/reminders/acknowledgement.model';
import NotificationAttempt from '../modules/reminders/notification-attempt.model';
import Device from '../modules/devices/device.model';
import AuditLog from '../modules/audit/audit-log.model';

export const initAssociations = (): void => {
  User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
  RefreshToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  User.hasMany(Device, { foreignKey: 'userId', as: 'devices' });
  Device.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  User.hasMany(Event, { foreignKey: 'createdById', as: 'createdEvents' });
  Event.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });

  Event.hasMany(EventAssignment, { foreignKey: 'eventId', as: 'assignments', onDelete: 'CASCADE' });
  EventAssignment.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });
  User.hasMany(EventAssignment, { foreignKey: 'userId', as: 'eventAssignments' });
  EventAssignment.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  Event.hasMany(ReminderRule, { foreignKey: 'eventId', as: 'reminderRules', onDelete: 'CASCADE' });
  ReminderRule.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });

  Event.hasMany(ReminderInstance, { foreignKey: 'eventId', as: 'reminderInstances', onDelete: 'CASCADE' });
  ReminderInstance.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });
  EventAssignment.hasMany(ReminderInstance, { foreignKey: 'assignmentId', as: 'reminderInstances', onDelete: 'CASCADE' });
  ReminderInstance.belongsTo(EventAssignment, { foreignKey: 'assignmentId', as: 'assignment' });
  ReminderRule.hasMany(ReminderInstance, { foreignKey: 'ruleId', as: 'instances', onDelete: 'CASCADE' });
  ReminderInstance.belongsTo(ReminderRule, { foreignKey: 'ruleId', as: 'rule' });
  User.hasMany(ReminderInstance, { foreignKey: 'userId', as: 'reminders' });
  ReminderInstance.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  ReminderInstance.hasOne(Acknowledgement, { foreignKey: 'reminderInstanceId', as: 'acknowledgement', onDelete: 'CASCADE' });
  Acknowledgement.belongsTo(ReminderInstance, { foreignKey: 'reminderInstanceId', as: 'reminderInstance' });
  User.hasMany(Acknowledgement, { foreignKey: 'userId', as: 'acknowledgements' });
  Acknowledgement.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  Event.hasMany(Acknowledgement, { foreignKey: 'eventId', as: 'acknowledgements' });
  Acknowledgement.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });

  ReminderInstance.hasMany(NotificationAttempt, { foreignKey: 'reminderInstanceId', as: 'attempts', onDelete: 'CASCADE' });
  NotificationAttempt.belongsTo(ReminderInstance, { foreignKey: 'reminderInstanceId', as: 'reminderInstance' });
  Device.hasMany(NotificationAttempt, { foreignKey: 'deviceId', as: 'attempts' });
  NotificationAttempt.belongsTo(Device, { foreignKey: 'deviceId', as: 'device' });

  User.hasMany(AuditLog, { foreignKey: 'actorId', as: 'auditLogs' });
  AuditLog.belongsTo(User, { foreignKey: 'actorId', as: 'actor' });
};

export {
  User,
  RefreshToken,
  Event,
  EventAssignment,
  ReminderRule,
  ReminderInstance,
  Acknowledgement,
  NotificationAttempt,
  Device,
  AuditLog,
};
