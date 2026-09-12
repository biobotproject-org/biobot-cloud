// ========== models/index.js ==========
const User = require('./User');
const Location = require('./Location');
const Device = require('./Device');
const Reading = require('./Reading');
const Alert = require('./Alert');
const AlertAcknowledgment = require('./AlertAcknowledgment');
const AlertThreshold = require('./AlertThreshold');
const PowerEvent = require('./PowerEvent');
const ApiKey = require('./ApiKey');
const Incident = require('./Incident');
const IncidentEvent = require('./IncidentEvent');

Device.belongsTo(Location, { foreignKey: 'locationId', as: 'location' });
Location.hasMany(Device, { foreignKey: 'locationId', as: 'devices' });

User.hasMany(Device, { foreignKey: 'createdBy', as: 'devices' });
Device.belongsTo(User, { foreignKey: 'createdBy', as: 'owner' });

Device.hasMany(Reading, { foreignKey: 'deviceId', as: 'readings' });
Reading.belongsTo(Device, { foreignKey: 'deviceId', as: 'device' });

Device.hasMany(Alert, { foreignKey: 'deviceId', as: 'alerts' });
Alert.belongsTo(Device, { foreignKey: 'deviceId', as: 'device' });

Alert.hasMany(AlertAcknowledgment, { foreignKey: 'alertId', as: 'acknowledgments' });
AlertAcknowledgment.belongsTo(Alert, { foreignKey: 'alertId', as: 'alert' });

User.hasMany(AlertAcknowledgment, { foreignKey: 'userId', as: 'acknowledgments' });
AlertAcknowledgment.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Location.hasMany(PowerEvent, { foreignKey: 'locationId', as: 'powerEvents' });
PowerEvent.belongsTo(Location, { foreignKey: 'locationId', as: 'location' });

User.hasMany(ApiKey, { foreignKey: 'userId', as: 'apiKeys', onDelete: 'CASCADE' });
ApiKey.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Device.hasMany(Incident, { foreignKey: 'deviceId', as: 'incidents' });
Incident.belongsTo(Device, { foreignKey: 'deviceId', as: 'device' });

Incident.hasMany(IncidentEvent, { foreignKey: 'incidentId', as: 'events', onDelete: 'CASCADE' });
IncidentEvent.belongsTo(Incident, { foreignKey: 'incidentId', as: 'incident' });

Incident.belongsTo(Alert, { foreignKey: 'alertId', as: 'alert' });

User.hasMany(Incident, { foreignKey: 'acknowledgedBy', as: 'acknowledgedIncidents' });
Incident.belongsTo(User, { foreignKey: 'acknowledgedBy', as: 'acknowledger' });

module.exports = {
  User,
  Location,
  Device,
  Reading,
  Alert,
  AlertAcknowledgment,
  AlertThreshold,
  PowerEvent,
  ApiKey,
  Incident,
  IncidentEvent
};