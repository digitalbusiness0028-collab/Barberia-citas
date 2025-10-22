\
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const db = new Database('barberia.db');

// Crear tablas si no existen
db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  service TEXT,
  start_time TEXT,
  end_time TEXT,
  status TEXT, -- scheduled, confirmed, cancelled, completed
  confirmation_token TEXT,
  created_at TEXT,
  notes TEXT,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);
`);

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

function getOrCreateCustomer({ name, email, phone }) {
  const row = db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
  if (row) return row;
  const id = uuidv4();
  const created_at = new Date().toISOString();
  db.prepare('INSERT INTO customers (id,name,email,phone,created_at) VALUES (?,?,?,?,?)')
    .run(id, name, email, phone, created_at);
  return { id, name, email, phone, created_at };
}

app.post('/api/book', (req, res) => {
  try {
    const { name, email, phone, service, date, time, duration = 30, notes } = req.body;
    if (!name || !email || !service || !date || !time) {
      return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    }
    const start = new Date(`${date}T${time}`);
    if (isNaN(start)) return res.status(400).json({ error: 'Fecha/hora inválida' });
    const end = new Date(start.getTime() + duration*60000);

    const overlapping = db.prepare(`
      SELECT * FROM appointments WHERE status IN ('scheduled','confirmed')
      AND (
        (datetime(start_time) <= datetime(?) AND datetime(end_time) > datetime(?))
        OR
        (datetime(start_time) < datetime(?) AND datetime(end_time) >= datetime(?))
        OR
        (datetime(start_time) >= datetime(?) AND datetime(end_time) <= datetime(?))
      )
    `).all(start.toISOString(), start.toISOString(), end.toISOString(), end.toISOString(), start.toISOString(), end.toISOString());

    if (overlapping.length > 0) {
      return res.status(409).json({ error: 'El horario ya está ocupado. Por favor elige otro horario.' });
    }

    const customer = getOrCreateCustomer({ name, email, phone });
    const appointmentId = uuidv4();
    const token = uuidv4();

    db.prepare(`
      INSERT INTO appointments (id, customer_id, service, start_time, end_time, status, confirmation_token, created_at, notes)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(appointmentId, customer.id, service, start.toISOString(), end.toISOString(), 'scheduled', token, new Date().toISOString(), notes || '');

    const ownerEmail = process.env.OWNER_EMAIL || process.env.SMTP_USER;
    const confirmUrl = `${req.protocol}://${req.get('host')}/confirm.html?token=${token}`;
    const dateLabel = new Date(start).toLocaleString();

    const mailToClient = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `Confirmación de cita - ${service}`,
      html: `
      <div style="background:#000;color:#f5d36c;padding:30px;font-family:'Playfair Display',serif;text-align:center">
        <h1 style="margin-bottom:10px;">${service}</h1>
        <p style="color:#fff;">Hola <b>${name}</b>, tu cita fue reservada provisionalmente para:</p>
        <p style="color:#ddd;">${dateLabel} — Duración: ${duration} min</p>
        <a href="${confirmUrl}" style="display:inline-block;margin-top:15px;background:#f5d36c;color:#000;padding:12px 20px;text-decoration:none;font-weight:bold;border-radius:5px;">
          Confirmar mi cita
        </a>
        <p style="color:#aaa;margin-top:25px;">Si no confirmas, podríamos liberar el horario.</p>
        <p style="color:#555;font-size:12px;margin-top:20px;">Gracias por confiar en <b>JRbarber</b>.</p>
      </div>`
    };

    const mailToOwner = {
      from: process.env.SMTP_USER,
      to: 'osfran_9@hotmail.com',
      subject: `Nueva cita agendada - ${name}`,
      text: `Nueva cita:
Cliente: ${name}
Email: ${email}
Tel: ${phone || '-'}
Servicio: ${service}
Fecha: ${date} ${time}
Duración: ${duration} minutos
Notas: ${notes || '-'}
`
    };

    transporter.sendMail(mailToClient).catch(err => console.error('Error enviando mail cliente:', err));
    transporter.sendMail(mailToOwner).catch(err => console.error('Error enviando mail owner:', err));

    return res.json({ ok: true, appointmentId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'invalid' });
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET || 'secret', { expiresIn: '12h' });
  res.json({ token });
});

function authAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'no auth' });
  const token = auth.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    if (payload.role === 'admin') return next();
    return res.status(403).json({ error: 'forbidden' });
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

app.get('/api/confirm/:token', (req, res) => {
  const { token } = req.params;
  const row = db.prepare('SELECT * FROM appointments WHERE confirmation_token = ?').get(token);
  if (!row) return res.status(404).json({ ok: false, error: 'Token inválido o cita no encontrada.' });
  if (row.status === 'confirmed') return res.json({ ok: true, message: 'Ya estaba confirmada.' });

  db.prepare('UPDATE appointments SET status = "confirmed" WHERE id = ?').run(row.id);
  res.json({ ok: true, message: 'Cita confirmada con éxito.' });
});

app.get('/api/admin/stats', authAdmin, (req, res) => {
  try {
    const days = db.prepare(`
      SELECT date(start_time) as day, COUNT(*) as count
      FROM appointments
      WHERE date(start_time) >= date('now','-29 days')
      GROUP BY day
      ORDER BY day
    `).all();

    const hours = db.prepare(`
      SELECT strftime('%H', start_time) as hour, COUNT(*) as count
      FROM appointments
      WHERE date(start_time) >= date('now','-90 days')
      GROUP BY hour
      ORDER BY hour
    `).all();

    const recurring = db.prepare(`
      SELECT c.name, c.email, c.phone, COUNT(a.id) as visits, MAX(a.start_time) as last_visit
      FROM customers c
      LEFT JOIN appointments a ON a.customer_id = c.id
      GROUP BY c.id
      HAVING visits > 0
      ORDER BY visits DESC
      LIMIT 10
    `).all();

    const totals = db.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        COUNT(*) as total
      FROM appointments
    `).get();

    res.json({ days, hours, recurring, totals });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/admin/appointments', authAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, c.name as customer_name, c.email, c.phone
    FROM appointments a
    LEFT JOIN customers c ON a.customer_id = c.id
    ORDER BY start_time DESC
    LIMIT 500
  `).all();
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
