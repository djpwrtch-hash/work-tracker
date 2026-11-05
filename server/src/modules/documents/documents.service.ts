import db, { uuid } from '../../db/index.js';
import { getIO } from '../../lib/socket.js';
import { AppError } from '../../lib/app-error.js';
import { documentFieldSchemas, DOC_TYPE_LABELS, DOC_TYPE_CODES, type DocType } from './documents.schema.js';
import { sendDocumentReady } from '../../lib/email.js';

const SELECT = `
  SELECT d.*,
         u.first_name, u.last_name, u.employee_id, u.designation, u.joining_date,
         u.dob, u.qualification, u.gender, u.address_street, u.address_city, u.address_state, u.address_pincode,
         u.father_name, u.phone_number, u.email,
         dept.name AS department_name,
         iu.first_name AS issued_by_first, iu.last_name AS issued_by_last
  FROM document_requests d
  JOIN users u ON d.user_id = u.id
  LEFT JOIN departments dept ON u.department_id = dept.id
  LEFT JOIN users iu ON d.issued_by_id = iu.id
`;

function mapDoc(r: any) {
  let fields: Record<string, unknown> | null = null;
  if (r.fields) {
    try { fields = JSON.parse(r.fields); } catch { fields = null; }
  }
  const label = DOC_TYPE_LABELS[r.doc_type as DocType] ?? r.doc_type;
  return {
    id: r.id,
    userId: r.user_id,
    requestedById: r.requested_by_id,
    docType: r.doc_type,
    docTypeLabel: label,
    note: r.note,
    status: r.status,
    rejectReason: r.reject_reason,
    fields,
    docNumber: r.doc_number,
    issuedById: r.issued_by_id,
    issuedAt: r.issued_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    firstName: r.first_name,
    lastName: r.last_name,
    employeeId: r.employee_id,
    designation: r.designation,
    departmentName: r.department_name,
    joiningDate: r.joining_date,
    dob: r.dob,
    qualification: r.qualification,
    gender: r.gender,
    addressStreet: r.address_street,
    addressCity: r.address_city,
    addressState: r.address_state,
    addressPincode: r.address_pincode,
    fatherName: r.father_name,
    phone: r.phone_number,
    email: r.email,
    issuedByName: r.issued_by_first ? `${r.issued_by_first} ${r.issued_by_last ?? ''}`.trim() : null,
  };
}

async function insertNotification(recipientId: string, senderId: string, title: string, message: string, type: string, link: string) {
  await db.prepare('INSERT INTO notifications (id, recipient_id, sender_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), recipientId, senderId, title, message, type, link);
}

function emitToUser(userId: string, event: string, payload: unknown) {
  try {
    getIO().to(`user:${userId}`).emit(event, payload);
  } catch (e) {
    console.error('[Documents] Socket emit failed:', e);
  }
}

function emitNotification(recipientId: string, payload: { title: string; message: string; type: string; link: string }) {
  try {
    getIO().to(`user:${recipientId}`).emit('notification:new', payload);
  } catch (e) {
    console.error('[Documents] Socket emit failed:', e);
  }
}

function isAdminRole(role: string): boolean {
  return role === 'director' || role === 'hr';
}

export class DocumentsService {
  static async create(requestedById: string, role: string, input: { docType: string; note?: string; userId?: string }) {
    const targetId = input.userId || requestedById;
    if (targetId !== requestedById && !isAdminRole(role)) {
      throw new AppError(403, 'Only directors and HR can request documents for other employees');
    }
    const label = DOC_TYPE_LABELS[input.docType as DocType];
    if (!label) throw new AppError(400, 'Unknown document type');

    const target = await db.prepare('SELECT id, first_name, last_name, status FROM users WHERE id = ?').get(targetId) as any;
    if (!target) throw new AppError(404, 'Employee not found');
    if (target.status !== 'active') throw new AppError(400, 'Employee account is not active');

    const id = uuid();
    await db.transaction(async () => {
      const duplicate = await db.prepare("SELECT id FROM document_requests WHERE user_id = ? AND doc_type = ? AND status = 'pending'").get(targetId, input.docType);
      if (duplicate) throw new AppError(409, `A pending ${label} request already exists for this employee`);
      await db.prepare('INSERT INTO document_requests (id, user_id, requested_by_id, doc_type, note) VALUES (?, ?, ?, ?, ?)')
        .run(id, targetId, requestedById, input.docType, input.note ?? null);
    })();
    const doc = mapDoc(await db.prepare(`${SELECT} WHERE d.id = ?`).get(id));

    const requester = await db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(requestedById) as any;
    const requesterName = requester ? `${requester.first_name} ${requester.last_name}`.trim() : 'An employee';
    const targetName = `${target.first_name} ${target.last_name}`.trim();
    const admins = await db.prepare("SELECT id FROM users WHERE role IN ('director', 'hr') AND status = 'active'").all() as any[];
    for (const a of admins) {
      if (a.id === requestedById) continue;
      const payload = {
        title: 'Document Requested',
        message: `${label} requested by ${targetName === requesterName ? requesterName : `${requesterName} for ${targetName}`} is pending review`,
        type: 'approval',
        link: '/documents',
      };
      await insertNotification(a.id, requestedById, payload.title, payload.message, payload.type, payload.link);
      emitNotification(a.id, payload);
      emitToUser(a.id, 'documents:requested', doc);
    }
    return doc;
  }

  static async list(query: { page?: number; limit?: number; status?: string; docType?: string; userId?: string }, userId: string, role: string) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const conds: string[] = [];
    const params: any[] = [];
    if (!isAdminRole(role)) {
      conds.push('d.user_id = ?');
      params.push(userId);
    } else if (query.userId) {
      conds.push('d.user_id = ?');
      params.push(query.userId);
    }
    if (query.status) {
      conds.push('d.status = ?');
      params.push(query.status);
    }
    if (query.docType) {
      conds.push('d.doc_type = ?');
      params.push(query.docType);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const rows = await db.prepare(`${SELECT} ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = (await db.prepare(`SELECT COUNT(*) AS c FROM document_requests d ${where}`).get(...params) as any).c;
    const pendingCount = (await db.prepare("SELECT COUNT(*) AS c FROM document_requests WHERE status = 'pending'").get() as any).c;
    return { documents: rows.map(mapDoc), total, page, limit, pendingCount };
  }

  static async getById(id: string, userId: string, role: string) {
    const row = await db.prepare(`${SELECT} WHERE d.id = ?`).get(id) as any;
    if (!row) throw new AppError(404, 'Document request not found');
    if (!isAdminRole(role) && row.user_id !== userId) throw new AppError(403, 'Forbidden');
    return mapDoc(row);
  }

  static async issue(id: string, reviewedById: string, role: string, input: { fields: Record<string, unknown> }) {
    if (!isAdminRole(role)) throw new AppError(403, 'Only directors and HR can issue documents');
    const doc = await db.prepare('SELECT * FROM document_requests WHERE id = ?').get(id) as any;
    if (!doc) throw new AppError(404, 'Document request not found');
    if (doc.status !== 'pending') throw new AppError(409, `Only pending requests can be issued (current status: ${doc.status})`);

    const fieldSchema = documentFieldSchemas[doc.doc_type as DocType];
    if (!fieldSchema) throw new AppError(400, 'Unknown document type');

    // Fill any employee fields the reviewer left blank from the live employee record
    const emp = await db.prepare(
      `SELECT u.first_name, u.last_name, u.employee_id, u.designation, u.joining_date,
              u.dob, u.qualification, u.gender, u.address_street, u.address_city, u.address_state, u.address_pincode,
              u.father_name, u.phone_number, u.email,
              dept.name AS department_name
       FROM users u LEFT JOIN departments dept ON u.department_id = dept.id WHERE u.id = ?`
    ).get(doc.user_id) as any;
    const inputFields: Record<string, unknown> = { ...(input.fields ?? {}) };
    if (emp) {
      const addressParts = [
        emp.address_street,
        emp.address_city,
        emp.address_state,
        emp.address_pincode ? `Pin- ${emp.address_pincode}` : '',
      ].filter(Boolean);
      const snapshot: Record<string, string> = {
        employeeName: `${emp.first_name} ${emp.last_name}`.trim(),
        gender: emp.gender ?? '',
        employeeId: emp.employee_id ?? '',
        designation: emp.designation ?? '',
        department: emp.department_name ?? '',
        joiningDate: emp.joining_date ?? '',
        employmentFrom: emp.joining_date ?? '',
        dob: emp.dob ?? '',
        qualification: emp.qualification ?? '',
        fatherName: emp.father_name ? (emp.father_name.startsWith('Mr.') ? emp.father_name : `Mr. ${emp.father_name}`) : '',
        phone: emp.phone_number ?? '',
        email: emp.email ?? '',
        enrolmentNumber: emp.employee_id ? `Employee ID: ${emp.employee_id}` : '',
        permanentAddress: addressParts.join('\n'),
      };
      // Compute tenure for relieving certificate if not provided
      if (doc.doc_type === 'leaving_certificate' && emp.joining_date && (inputFields as any).relievingDate) {
        const joining = new Date(emp.joining_date);
        const relieving = new Date((inputFields as any).relievingDate);
        const months = (relieving.getFullYear() - joining.getFullYear()) * 12 + (relieving.getMonth() - joining.getMonth()) + 1;
        snapshot.tenure = `${months} months`;
      }
    // Compute tenure already done above; now merge snapshot into inputFields
    for (const [key, value] of Object.entries(snapshot)) {
      if (!value) continue; // never inject empty strings - optional fields must stay undefined
      const current = inputFields[key];
      if (current === undefined || current === null || current === '') inputFields[key] = value;
    }
   }

    // Salary slip alias mapping: frontend uses daysWorked/basicPay/travellingAllowance, backend expects paidDays/basic/conveyance
    if (doc.doc_type === 'salary_slip') {
      const f: any = inputFields;
      if (f.daysWorked !== undefined && f.paidDays === undefined) f.paidDays = f.daysWorked;
      if (f.basicPay !== undefined && f.basic === undefined) f.basic = f.basicPay;
      if (f.travellingAllowance !== undefined && f.conveyance === undefined) f.conveyance = f.travellingAllowance;
      if (f.dearnessAllowance !== undefined && f.hra === undefined) f.hra = f.dearnessAllowance;
      if (f.variablePay !== undefined && f.specialAllowance === undefined) f.specialAllowance = f.variablePay;
      // lopDays optional, ensure number
      if (f.advancePaid !== undefined && f.otherDeductions === undefined) f.otherDeductions = f.advancePaid;
      // Ensure required fields have defaults if still missing
      if (f.paidDays === undefined || f.paidDays === '') f.paidDays = 30;
      if (f.basic === undefined || f.basic === '') f.basic = 0;
    }

    const parsed = fieldSchema.safeParse(inputFields);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AppError(400, first?.message ?? 'Invalid document fields');
    }
    const fields: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) };

    if (doc.doc_type === 'salary_slip') {
      const num = (v: unknown) => Number(v ?? 0) || 0;
      const gross = num(fields.basic) + num(fields.hra) + num(fields.conveyance) + num(fields.medicalAllowance) + num(fields.specialAllowance);
      const deductions = num(fields.pf) + num(fields.professionalTax) + num(fields.tds) + num(fields.otherDeductions);
      fields.grossEarnings = Math.round(gross * 100) / 100;
      fields.totalDeductions = Math.round(deductions * 100) / 100;
      fields.netPay = Math.round((gross - deductions) * 100) / 100;
    }

    const updated = await db.transaction(async () => {
      const year = new Date().getFullYear();
      const code = DOC_TYPE_CODES[doc.doc_type as DocType] ?? 'DOC';
      const seq = (await db.prepare(
        "SELECT COUNT(*) AS c FROM document_requests WHERE doc_type = ? AND status = 'issued' AND YEAR(issued_at) = ?"
      ).get(doc.doc_type, year) as any).c;
      let dn: string | null;
      if (doc.doc_type === 'appointment_letter') {
        dn = `SSPT/HR/${year}/${String(seq + 1).padStart(4, '0')}`;
      } else if (doc.doc_type === 'leaving_certificate') {
        dn = `SSPTPL/HR /${year.toString().slice(-2)}/${String(seq + 1).padStart(4, '0')}`;
      } else if (doc.doc_type === 'internship_certificate') {
        dn = `SSPTPL/HR /${year.toString().slice(-2)}/${String(seq + 1).padStart(4, '0')}`;
      } else if (doc.doc_type === 'experience_certificate') {
        dn = null; // Experience certificates don't have reference numbers
      } else {
        dn = `WT-${code}-${year}-${String(seq + 1).padStart(4, '0')}`;
      }

      await db.prepare("UPDATE document_requests SET status = 'issued', fields = ?, doc_number = ?, issued_by_id = ?, issued_at = NOW(), updated_at = NOW() WHERE id = ?")
        .run(JSON.stringify(fields), dn, reviewedById, id);
      return { doc: mapDoc(await db.prepare(`${SELECT} WHERE d.id = ?`).get(id)), docNumber: dn || 'N/A' };
    })();

    const docNumber = updated.docNumber;

    const label = DOC_TYPE_LABELS[doc.doc_type as DocType] ?? doc.doc_type;
    const payload = {
      title: 'Document Ready',
      message: `Your ${label} is ready to download`,
      type: 'success',
      link: '/documents',
    };
    await insertNotification(doc.user_id, reviewedById, payload.title, payload.message, payload.type, payload.link);
    emitNotification(doc.user_id, payload);
    emitToUser(doc.user_id, 'documents:issued', updated.doc);

    const recipient = await db.prepare('SELECT id, email, first_name, last_name FROM users WHERE id = ?').get(doc.user_id) as any;
    if (recipient) {
      try { await sendDocumentReady({ id: doc.id, docType: doc.doc_type, docNumber }, { id: recipient.id, email: recipient.email, firstName: recipient.first_name, lastName: recipient.last_name }); } catch (e: any) { console.error('[Email] Failed:', e.message); }
    }
    return updated.doc;
  }

  static async reject(id: string, reviewedById: string, role: string, reason?: string) {
    if (!isAdminRole(role)) throw new AppError(403, 'Only directors and HR can reject document requests');
    const doc = await db.prepare('SELECT * FROM document_requests WHERE id = ?').get(id) as any;
    if (!doc) throw new AppError(404, 'Document request not found');
    if (doc.status !== 'pending') throw new AppError(409, `Only pending requests can be rejected (current status: ${doc.status})`);

    await db.prepare("UPDATE document_requests SET status = 'rejected', reject_reason = ?, updated_at = NOW() WHERE id = ?")
      .run(reason ?? null, id);
    const updated = mapDoc(await db.prepare(`${SELECT} WHERE d.id = ?`).get(id));

    const label = DOC_TYPE_LABELS[doc.doc_type as DocType] ?? doc.doc_type;
    const payload = {
      title: 'Document Request Rejected',
      message: reason ? `Your ${label} request was rejected: ${reason}` : `Your ${label} request was rejected`,
      type: 'warning',
      link: '/documents',
    };
    await insertNotification(doc.user_id, reviewedById, payload.title, payload.message, payload.type, payload.link);
    emitNotification(doc.user_id, payload);
    emitToUser(doc.user_id, 'documents:rejected', updated);
    return updated;
  }

  static async cancel(id: string, userId: string, role: string) {
    const doc = await db.prepare('SELECT id, user_id, status FROM document_requests WHERE id = ?').get(id) as any;
    if (!doc) throw new AppError(404, 'Document request not found');
    if (doc.user_id !== userId && !isAdminRole(role)) throw new AppError(403, 'Forbidden');
    if (doc.status !== 'pending') throw new AppError(409, 'Only pending requests can be cancelled');
    await db.prepare("UPDATE document_requests SET status = 'cancelled', updated_at = NOW() WHERE id = ?").run(id);
    return mapDoc(await db.prepare(`${SELECT} WHERE d.id = ?`).get(id));
  }

  static async download(id: string, userId: string, role: string) {
    const doc = await this.getById(id, userId, role);
    if (doc.status !== 'issued') throw new AppError(409, 'Document has not been issued yet');
    // For experience certificates, docNumber might be null - handle this gracefully
    return { document: doc, generatedAt: new Date().toISOString() };
  }
}
