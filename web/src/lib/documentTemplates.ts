// Boilerplate document templates + PDF/DOCX (Word) rendering for the Documents module.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlignmentType,
  BorderStyle,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  Document as DocxDocument,
  ImageRun,
} from 'docx';
import {
  SWAIN_SIGNATURE_B64,
  SWAIN_BLUE_SIG_B64,
} from './appointmentAssets';
import { POWERTECH_LOGO_B64, POWERTECH_LOGO_ASPECT } from './powertechAssets';
const b64Raw = (s: string) => s.includes(',') ? s.slice(s.indexOf(',')+1) : s;
import { COMPANY_CONFIG, COLORS } from './companyConfig';
import { getDocumentConfig, type DocumentTypeConfig } from './documentTypeConfig';

// Footer and page-break constants
const FOOTER_MARGIN = 15; // mm from bottom edge
const FOOTER_SAFE_ZONE = 14; // mm threshold for checkPageBreak
const PAGE_BREAK_DEFAULT_NEEDED = 20; // mm - reduced from 60
const SALARY_SECTION_NEEDED = 8; // mm for salary section titles

export type DocumentDocType =
  | 'appointment_letter'
  | 'experience_certificate'
  | 'internship_certificate'
  | 'leaving_certificate'
  | 'salary_slip';

export const DOC_TYPES: { value: DocumentDocType; label: string }[] = [
  { value: 'appointment_letter', label: 'Appointment Letter' },
  { value: 'experience_certificate', label: 'Experience Certificate' },
  { value: 'internship_certificate', label: 'Internship Certificate' },
  { value: 'leaving_certificate', label: 'Relieving Certificate' },
  { value: 'salary_slip', label: 'Salary Slip' },
];

export const docTypeLabel = (t: string) => DOC_TYPES.find((d) => d.value === t)?.label ?? (t === 'leaving_certificate' ? 'Relieving Certificate' : t);

export const COMPANY = {
  name: 'WorkTracker Technologies Pvt. Ltd.',
  address: '123 Business Park, MG Road, Bengaluru, Karnataka 560001',
  cin: 'U72900KA2020PTC000000',
};

// Swain & Sons Power Tech Pvt. Ltd. corporate details (using new configuration system)
export const SWAIN_COMPANY = {
  name: COMPANY_CONFIG.name,
  accreditation: COMPANY_CONFIG.accreditations.default,
  corporateOffice: COMPANY_CONFIG.corporateOffice.address,
  phone: `Phone: ${COMPANY_CONFIG.corporateOffice.phones.standard.join(', ')}`,
  expPhone: `Phone: ${COMPANY_CONFIG.corporateOffice.phones.withWhatsapp.join(', ')}`,
  emailWeb: `Email: ${COMPANY_CONFIG.corporateOffice.emails.join(', ')}, Website: ${COMPANY_CONFIG.corporateOffice.website}`,
  expEmailWeb: `Email: ${COMPANY_CONFIG.corporateOffice.emails.join(', ')}, Website: ${COMPANY_CONFIG.corporateOffice.website}`,
  cin: COMPANY_CONFIG.cin,
  regdOffice: `${COMPANY_CONFIG.registeredOffice.address}, Phone- ${COMPANY_CONFIG.registeredOffice.phone}`,
  expRegdOffice: `${COMPANY_CONFIG.registeredOffice.address}, Phone- ${COMPANY_CONFIG.registeredOffice.phone.split(', ')[1]}`,
  webPortal: COMPANY_CONFIG.website,
  managerName: COMPANY_CONFIG.management.name,
  managerTitle: COMPANY_CONFIG.management.title,
  managerHrTitle: COMPANY_CONFIG.management.hrTitle,
  managerHrAdmnTitle: COMPANY_CONFIG.management.hrAdmnTitle,
  managerPhone: COMPANY_CONFIG.management.phone,
  managerEmail: COMPANY_CONFIG.management.email,
  managerWeb: COMPANY_CONFIG.management.web,
};

export const DEFAULT_APPOINTMENT_RESPONSIBILITIES = [
  'Collaborating with other team members to develop project plans and timelines.',
  'Conducting research and analysis to support project deliverables.',
  'Monitoring project progress and identifying potential risks or issues.',
  'Communicating project updates to stakeholders.',
  'Developing and maintaining project documentation.',
  'Participating in meetings and presentations as needed.',
];

export const getSalutation = (gender?: unknown): string => {
  const g = String(gender || '').toLowerCase();
  if (g === 'female') return 'Ms.';
  if (g === 'other') return 'Mx.';
  return 'Mr.';
};

export const getPronoun = (gender?: unknown): { subject: string; possessive: string; object: string } => {
  const g = String(gender || '').toLowerCase();
  if (g === 'female') return { subject: 'She', possessive: 'her', object: 'her' };
  if (g === 'other') return { subject: 'They', possessive: 'their', object: 'them' };
  return { subject: 'He', possessive: 'his', object: 'him' };
};

// "S/o Mr. X" for sons, "D/o Mr. X" for daughters. The parent's own
// salutation is kept when present, otherwise defaults to Mr. (father).
// Never derives the parent's salutation from the employee's gender.
export const formatParentRelation = (gender?: unknown, parentName?: unknown): string => {
  const raw = String(parentName || '').trim();
  if (!raw) return '';
  const g = String(gender || '').toLowerCase();
  const relation = g === 'female' ? 'D/o' : 'S/o';
  const hasPrefix = raw.startsWith('Mr.') || raw.startsWith('Ms.') || raw.startsWith('Mrs.') || raw.startsWith('Mx.');
  return `, ${relation} ${hasPrefix ? raw : `Mr. ${raw}`}`;
};

// "One month" / "Two months" from internship date range (defaults to One month).
export const formatInternshipDuration = (from?: unknown, to?: unknown): string => {
  const fromD = new Date(String(from || ''));
  const toD = new Date(String(to || ''));
  if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) return 'One month';
  const months = Math.max(1, (toD.getFullYear() - fromD.getFullYear()) * 12 + (toD.getMonth() - fromD.getMonth()) + 1);
  if (months === 1) return 'One month';
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  return `${words[months] ?? String(months)} months`;
};

export const DEFAULT_APPOINTMENT_TERMS = (salary = 'Rs. 6000/-', hours = '8 hours per day') => [
  `The students shall be paid monthly Salary of ${salary.startsWith('Rs.') ? salary : `Rs. ${salary}/-`}`,
  `You will be expected to work ${hours}`,
  'You will be entitled to (Vacation Days/Leave) as per company rules.',
  'The work station shall be provided by our office, during the internship',
  'The Interns shall work as per our company guideline and quality manual.',
];

export const DEFAULT_EXPERIENCE_PROJECT_REMARKS = (name = 'Mr. Sukhwinder Singh', gender?: unknown) => {
  const p = getPronoun(gender);
  return `During this period, ${name} was involved in conducting energy audits in various industries and MSMEs. ${p.subject} was also involved in the implementation of Energy Efficiency and Energy Conservation Projects and ESCO activities, particularly in Commercial Buildings, Railways, and Designated Consumers under the PAT Scheme. ${p.subject} was also involved in Demand Side Management activities of DISCOM. ${p.subject} contributed as a team member in our energy efficiency projects, including the implementation of ECBC in various buildings.`;
};

export interface DocFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'textarea' | 'select';
  prefill?: string;
  placeholder?: string;
  options?: string[];
}

export interface DocTemplateDef {
  type: DocumentDocType;
  label: string;
  description: string;
  fields: DocFieldDef[];
}

export const DOC_TEMPLATES: Record<DocumentDocType, DocTemplateDef> = {
  appointment_letter: {
    type: 'appointment_letter',
    label: 'Appointment Letter',
    description: 'Power Tech Consultants formal appointment letter with dynamic details & terms',
    fields: [
      { key: 'employeeName', label: 'Candidate / Employee Name', prefill: 'name' },
      { key: 'gender', label: 'Gender', type: 'select', prefill: 'gender', options: ['male', 'female', 'other'] },
      { key: 'dob', label: 'Date of Birth', type: 'date', prefill: 'dob' },
      { key: 'designation', label: 'Position / Designation', prefill: 'designation', placeholder: 'e.g. Project Associate' },
      { key: 'joiningDate', label: 'Commencement / Joining Date', type: 'date', prefill: 'joiningDate' },
      { key: 'university', label: 'College / University / Institution', type: 'text', placeholder: 'e.g. DRIEMS UNIVERSITY, Cuttack.' },
      { key: 'qualification', label: 'Degree / Qualification', type: 'text', prefill: 'qualification', placeholder: 'e.g. Bachelor of Technology in Electrical Engineering' },
      { key: 'enrolmentNumber', label: 'College Enrolment Number or Employee ID', type: 'text', prefill: 'enrolmentNumber', placeholder: 'e.g. 2001229166' },
      { key: 'permanentAddress', label: 'Permanent Address', type: 'textarea', prefill: 'address', placeholder: 'Dhelwan, Near Government School,\nBypass Patna Bihar\nPS - Ram Krishna Nagar.\nPost office - Dhelwan.\nPincode -800020' },
      { key: 'monthlySalary', label: 'Monthly Salary / Stipend', type: 'text', placeholder: 'e.g. Rs. 6000/-' },
      { key: 'workingHours', label: 'Working Hours', type: 'text', placeholder: 'e.g. 8 hours per day' },
      { key: 'responsibilities', label: 'Role Responsibilities (one per line)', type: 'textarea', placeholder: 'List responsibilities line by line' },
      { key: 'terms', label: 'Terms and Conditions (one per line)', type: 'textarea', placeholder: 'List terms and conditions line by line' },
      { key: 'content', label: 'Additional Content (optional)', type: 'textarea', placeholder: 'Extra paragraphs appended at the end of the letter - leave blank for default' },
    ],
  },
  experience_certificate: {
    type: 'experience_certificate',
    label: 'Experience Certificate',
    description: 'Power Tech Consultants formal experience certificate certifying tenure, project involvement & conduct',
    fields: [
      { key: 'employeeName', label: 'Employee Name', prefill: 'name' },
      { key: 'gender', label: 'Gender', type: 'select', prefill: 'gender', options: ['male', 'female', 'other'] },
      { key: 'fatherName', label: "Father's Name", prefill: 'fatherName', placeholder: 'e.g. Mr. Krishan Kumar' },
      { key: 'designation', label: 'Designation / Role', prefill: 'designation', placeholder: 'e.g. Energy Engineer' },
      { key: 'employmentFrom', label: 'Employment From', type: 'date', prefill: 'employmentFrom' },
      { key: 'employmentTo', label: 'Employment To (Last Working Date)', type: 'date' },
      { key: 'permanentAddress', label: 'Residential Address', type: 'textarea', prefill: 'address', placeholder: 'e.g. Behind Oxford School, Professor Colony, Gulha Road, Cheeka' },
      { key: 'projectRemarks', label: 'Project Involvement & Description', type: 'textarea', placeholder: 'Details of audits, energy efficiency projects...' },
      { key: 'conductRemark', label: 'Conduct Remark', type: 'text', placeholder: 'e.g. She is sincere, hardworking, and her conduct is good.' },
      { key: 'place', label: 'Place', type: 'text', placeholder: 'Bhubaneswar' },
      { key: 'content', label: 'Additional Content (optional)', type: 'textarea', placeholder: 'Extra paragraphs appended at the end of the letter - leave blank for default' },
    ],
  },
  internship_certificate: {
    type: 'internship_certificate',
    label: 'Internship Certificate',
    description: 'Certifies internship completion for a student/trainee',
    fields: [
      { key: 'internName', label: 'Intern Name', prefill: 'name' },
      { key: 'gender', label: 'Gender', type: 'select', prefill: 'gender', options: ['male', 'female', 'other'] },
      { key: 'institution', label: 'Institution / College', type: 'text' },
      { key: 'registrationNumber', label: 'Registration Number', type: 'text' },
      { key: 'fatherName', label: "Father's Name", type: 'text' },
      { key: 'domain', label: 'Internship Domain (e.g. Full Stack Development)', type: 'text' },
      { key: 'internshipFrom', label: 'Internship From', type: 'date', prefill: 'joiningDate' },
      { key: 'internshipTo', label: 'Internship To', type: 'date' },
      { key: 'completionRemark', label: 'Completion Remark (optional)', type: 'textarea' },
      { key: 'content', label: 'Additional Content (optional)', type: 'textarea', placeholder: 'Extra paragraphs appended at the end of the letter - leave blank for default' },
    ],
  },
  leaving_certificate: {
    type: 'leaving_certificate',
    label: 'Relieving Certificate',
    description: 'Power Tech Consultants formal relieving letter accepting resignation and confirming dues clearance',
    fields: [
      { key: 'employeeName', label: 'Employee Name', prefill: 'name' },
      { key: 'gender', label: 'Gender', type: 'select', prefill: 'gender', options: ['male', 'female', 'other'] },
      { key: 'resignationDate', label: 'Resignation Letter Date', type: 'date', placeholder: 'Date of resignation letter' },
      { key: 'relievingDate', label: 'Relieving Date', type: 'date' },
      { key: 'settlementDate', label: 'Full & Final Settlement Date', type: 'date', placeholder: 'Defaults to Relieving Date' },
      { key: 'tenure', label: 'Service Tenure', type: 'text', placeholder: 'e.g. last 9 months' },
      { key: 'permanentAddress', label: 'Employee Address', type: 'textarea', prefill: 'address', placeholder: 'At- Badabhun\nP.O/PS- Narsinghpur,\nPin- 754032' },
      { key: 'phone', label: 'Contact No', type: 'text', prefill: 'phone' },
      { key: 'email', label: 'Email', type: 'text', prefill: 'email' },
      { key: 'content', label: 'Additional Content (optional)', type: 'textarea', placeholder: 'Extra paragraphs appended at the end of the letter - leave blank for default' },
    ],
  },
  salary_slip: {
    type: 'salary_slip',
    label: 'Salary Slip',
    description: 'Monthly payslip with earnings, deductions, employer contributions and net payable',
    fields: [
      { key: 'employeeName', label: 'Employee Name', prefill: 'name' },
      { key: 'employeeId', label: 'Employee ID', prefill: 'employeeId' },
      { key: 'designation', label: 'Designation', prefill: 'designation' },
      { key: 'department', label: 'Department / Project', prefill: 'department' },
      { key: 'month', label: 'Salary Month (e.g. August)', type: 'text' },
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'daysWorked', label: 'No. of Days Worked', type: 'number' },
      { key: 'uan', label: 'UAN', type: 'text' },
      { key: 'joiningDate', label: 'Date of Joining', type: 'date', prefill: 'joiningDate' },
      { key: 'basicPay', label: 'Basic Pay (Rs.)', type: 'number' },
      { key: 'dearnessAllowance', label: 'Dearness Allowance (Rs.)', type: 'number' },
      { key: 'variablePay', label: 'Variable Pay (Rs.)', type: 'number' },
      { key: 'travellingAllowance', label: 'Travelling Allowance (Rs.)', type: 'number' },
      { key: 'hra', label: 'House Rent Allowance (Rs.)', type: 'number' },
      { key: 'projectAllowance', label: 'Project Allowance (Rs.)', type: 'number' },
      { key: 'responsibilityAllowance', label: 'Responsibility Allowance (Rs.)', type: 'number' },
      { key: 'specialAllowance', label: 'Special Allowance (Rs.)', type: 'number' },
      { key: 'performanceIncentive', label: 'Performance Incentive (Rs.)', type: 'number' },
      { key: 'annualBonus', label: 'Annual Bonus (Rs.)', type: 'number' },
      { key: 'compensatoryAllowance', label: 'Compensatory Allowance (Rs.)', type: 'number' },
      { key: 'pf', label: 'Provident Fund (Rs.)', type: 'number' },
      { key: 'esi', label: 'E.S.I. (Rs.)', type: 'number' },
      { key: 'employerPf', label: 'Employer Contribution - PF (Rs.)', type: 'number' },
      { key: 'employerEsi', label: 'Employer Contribution - ESI (Rs.)', type: 'number' },
      { key: 'advancePaid', label: 'Advance Paid (Rs.)', type: 'number' },
      { key: 'excessLeaveDeduction', label: 'Excess Leave Deduction (Rs.)', type: 'number' },
    ],
  },
};

// ---------- formatting helpers ----------

export const fmtDate = (v: unknown): string => {
  if (!v) return '-';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

export const fmtOrdinalDate = (v: unknown): string => {
  if (!v) return '-';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const day = d.getDate();
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const vRem = day % 100;
  const suffix = vRem >= 11 && vRem <= 13 ? 'th' : suffixes[day % 10] || 'th';
  const month = d.toLocaleDateString('en-IN', { month: 'long' });
  const year = d.getFullYear();
  return `${day}${suffix} ${month} ${year}`;
};

export const fmtDotDate = (v: unknown): string => {
  if (!v) return '-';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
};

export const fmtDateDDMMYYYY = (v: unknown): string => {
  if (!v) return '-';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
};

export const fmtDateRangeDDMMYYYY = (from: unknown, to: unknown): string => {
  return `${fmtDateDDMMYYYY(from)} to ${fmtDateDDMMYYYY(to)}`;
};

export const fmtINR = (v: unknown): string => {
  const n = Number(v ?? 0) || 0;
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Indian numbering "in words" converter (Rupees + Paise)
export function amountInWordsINR(v: number): string {
  const negative = v < 0;
  const totalPaise = Math.round(Math.abs(v) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const two = (x: number): string => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`);
  const words = (x: number): string => {
    if (x < 100) return two(x);
    if (x < 1000) return `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${two(x % 100)}` : ''}`;
    const crore = Math.floor(x / 10000000);
    const lakh = Math.floor((x % 10000000) / 100000);
    const thousand = Math.floor((x % 100000) / 1000);
    const rest = x % 1000;
    let out = '';
    if (crore) out += `${words(crore)} Crore `;
    if (lakh) out += `${words(lakh)} Lakh `;
    if (thousand) out += `${words(thousand)} Thousand `;
    if (rest) out += words(rest);
    return out.trim();
  };

  if (rupees === 0 && paise === 0) return 'Rupees Zero Only.';
  const rupeePart = words(rupees);
  const paisePart = paise ? ` and ${words(paise)} Paise` : '';
  return `${negative ? 'Minus ' : ''}Rupees ${rupeePart}${paisePart} Only.`;
}

export interface SalarySlipCalc {
  basicPay: number;
  epfoBasic: number;
  totalEarnings: number;
  employeeDeductions: number;
  employerContributions: number;
  grossTotal: number;
  netTotal: number;
  advancePaid: number;
  excessLeaveDeduction: number;
  netPayable: number;
}

export function calcSalarySlip(f: Record<string, unknown>): SalarySlipCalc {
  const num = (k: string) => Number(f[k] ?? 0) || 0;
  const basicPay = num('basicPay');
  const dearnessAllowance = num('dearnessAllowance');
  const totalEarnings =
    basicPay +
    dearnessAllowance +
    num('variablePay') +
    num('travellingAllowance') +
    num('hra') +
    num('projectAllowance') +
    num('responsibilityAllowance') +
    num('specialAllowance') +
    num('performanceIncentive') +
    num('annualBonus') +
    num('compensatoryAllowance');
  const pf = num('pf');
  const esi = num('esi');
  const employeeDeductions = pf + esi;
  const employerContributions = num('employerPf') + num('employerEsi');
  const grossTotal = totalEarnings + employerContributions;
  const netTotal = totalEarnings - employeeDeductions;
  const advancePaid = num('advancePaid');
  const excessLeaveDeduction = num('excessLeaveDeduction');
  const netPayable = netTotal - advancePaid - excessLeaveDeduction;
  return {
    basicPay,
    epfoBasic: basicPay + dearnessAllowance,
    totalEarnings,
    employeeDeductions,
    employerContributions,
    grossTotal,
    netTotal,
    advancePaid,
    excessLeaveDeduction,
    netPayable,
  };
}

export interface DocumentRenderInput {
  docType: DocumentDocType;
  fields: Record<string, unknown>;
  docNumber: string;
  issueDate: string; // ISO date
  issuedBy?: string | null;
}

export type DocumentPdfInput = DocumentRenderInput;

// ---------- Shared Generic Letterhead for other certs ----------

function drawLetterhead(doc: jsPDF) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 30, 60);
  doc.text(COMPANY.name, w / 2, 20, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 110);
  doc.text(COMPANY.address, w / 2, 26, { align: 'center' });
  doc.text(`CIN: ${COMPANY.cin}`, w / 2, 31, { align: 'center' });
  doc.setDrawColor(30, 30, 60);
  doc.setLineWidth(0.8);
  doc.line(14, 35, w - 14, 35);
  doc.setTextColor(0, 0, 0);
}

function drawTitle(doc: jsPDF, title: string, issueDate: string, docNumber: string) {
  const w = doc.internal.pageSize.getWidth();
  let y = 48;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(200, 30, 30);
  doc.text(title.toUpperCase(), w / 2, y, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  y += 7;
  doc.text(`Date: ${fmtDate(issueDate)}`, w - 14, y, { align: 'right' });
  doc.text(`Ref No: ${docNumber}`, 14, y);
  doc.setTextColor(0, 0, 0);
  return y + 10;
}

function drawSignature(doc: jsPDF, issuedBy?: string | null) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const w = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(`For ${COMPANY.name}`, w - 14, pageHeight - 38, { align: 'right' });
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.3);
  doc.line(w - 74, pageHeight - 22, w - 14, pageHeight - 22);
  doc.text(issuedBy || 'Authorised Signatory', w - 14, pageHeight - 17, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text('Authorised Signatory', w - 14, pageHeight - 12, { align: 'right' });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('This is a computer generated document and does not require a physical signature.', w / 2, pageHeight - 6, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

function drawKeyValueGrid(doc: jsPDF, pairs: [string, string | number][], y: number): number {
  const w = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const colW = (w - 28) / 2;
  let x = 14;
  let row = y;
  doc.setFontSize(9.5);
  for (let i = 0; i < pairs.length; i++) {
    const [k, v] = pairs[i];
    if (i > 0 && i % 2 === 0) {
      x = 14;
      row += 7.5;
      if (row > pageH - 14) {
        row = 25;
        doc.addPage();
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`${k}:`, x, row);
    doc.setFont('helvetica', 'normal');
    doc.text(String(v ?? '-'), x + colW * 0.42, row);
    x += colW;
  }
  return row + 8;
}

// ---------- Swain & Sons Letterhead & Footer Helpers (PDF) ----------

function drawSwainHeader(
  doc: jsPDF,
  docConfig: DocumentTypeConfig,
  opts: { accreditation?: boolean; expPhone?: boolean; expEmail?: boolean } = {},
) {
  const pageW = doc.internal.pageSize.getWidth();
  // In the original letterhead the heading sits just right of the page centre
  const centerX = 112;

  // Logo block at top-left (badge + Power Bazar mark), ~31x33mm as in the original
  try {
    const logoW = 31;
    const logoH = logoW * POWERTECH_LOGO_ASPECT;
    doc.addImage(POWERTECH_LOGO_B64, 'PNG', 5, 4, logoW, logoH);
  } catch (e) {
    console.error('Logo render error:', e);
  }

  const [r, g, b] = COLORS.companyRed;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(36);
  doc.setTextColor(r, g, b);
  doc.text('Power Tech Consultants', centerX, 14, { align: 'center' });

  const [cr, cg, cb] = COLORS.corporateBlue;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(cr, cg, cb);

  doc.text(`Corporate Office: ${COMPANY_CONFIG.corporateOffice.address}`, centerX, 21, { align: 'center' });
  doc.text(`Phone: ${COMPANY_CONFIG.corporateOffice.phones.withWhatsapp.join(', ')}`, centerX, 25.9, { align: 'center' });
  doc.text(`Email: ${COMPANY_CONFIG.corporateOffice.emails.join(', ')} Website: ${COMPANY_CONFIG.corporateOffice.website}`, centerX, 30.7, { align: 'center' });

  // Double rule under the header, nearly full width as in the original
  doc.setDrawColor(cr, cg, cb);
  doc.setLineWidth(0.5);
  doc.line(6, 35.5, pageW - 6, 35.5);
  doc.setLineWidth(0.25);
  doc.line(6, 36.3, pageW - 6, 36.3);
  doc.setTextColor(0, 0, 0);
}

/** Page break guard: if y would exceed the safe footer zone, start a new page. */
function checkPageBreak(doc: jsPDF, y: number, needed: number = PAGE_BREAK_DEFAULT_NEEDED, drawFooterFn?: (d: jsPDF) => void, drawHeaderFn?: (d: jsPDF) => void): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - FOOTER_SAFE_ZONE) {
    if (drawFooterFn) drawFooterFn(doc);
    doc.addPage();
    if (drawHeaderFn) drawHeaderFn(doc);
    return 25;
  }
  return y;
}

function drawSwainFooter(doc: jsPDF) {
  const w = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const footerLineY = pageH - FOOTER_MARGIN;

  doc.setDrawColor(0, 32, 96);
  doc.setLineWidth(0.6);
  doc.line(4, footerLineY, w - 4, footerLineY);

  // Original layout: regd+phone on ONE line, website below — lifted for print safe zone
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(0, 32, 96);
  doc.text(`Regd. Office: ${COMPANY_CONFIG.registeredOffice.address.replace('Regd. Office: ', '')}, Phone- ${COMPANY_CONFIG.registeredOffice.phone}`, w / 2, footerLineY + 3, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(192, 0, 0);
  doc.text(SWAIN_COMPANY.webPortal, w / 2, footerLineY + 7, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
}

// ---------- Swain & Sons Appointment Letter (PDF) ----------

function getContentParas(fields: Record<string, unknown>): string[] {
  const raw = fields?.content;
  if (!raw) return [];
  return String(raw).split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function buildAppointmentLetter(doc: jsPDF, input: DocumentPdfInput) {
  const f = input.fields;
  const docConfig = getDocumentConfig(input.docType);
  const marginL = 14;
  const marginR = 196;
  const contentW = marginR - marginL;

  drawSwainHeader(doc, docConfig, { accreditation: true });

  // reset header font state so body text never inherits 12pt blue
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  let y = 42;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const refText = input.docNumber ? `Ref: ${input.docNumber}` : 'Ref: SSPT/HR/2024';
  doc.text(refText, marginL, y);
  const dateFormatted = fmtOrdinalDate(input.issueDate || new Date().toISOString());
  doc.text(`Date: ${dateFormatted}`, marginR, y, { align: 'right' });

  y = 48;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(String(f.employeeName || 'Candidate Name'), marginL, y);
  y += 4.2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (f.university) {
    doc.text(String(f.university), marginL, y);
    y += 4.2;
  }
  if (f.qualification) {
    doc.text(String(f.qualification), marginL, y);
    y += 4.2;
  }
  if (f.enrolmentNumber) {
    const enStr = String(f.enrolmentNumber).trim();
    const formattedEn = enStr.toLowerCase().includes('enrolment') || enStr.toLowerCase().includes('id')
      ? enStr
      : `College Enrolment Number: - ${enStr}`;
    doc.text(formattedEn, marginL, y);
    y += 4.2;
  }

  y += 1.5;
  doc.setFont('helvetica', 'bold');
  doc.text('Permanent Address', marginL, y);
  y += 4.2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  if (f.permanentAddress) {
    const addrLines = String(f.permanentAddress).split('\n');
    for (const rawLine of addrLines) {
      const line = rawLine.trim();
      if (line) {
        y = checkPageBreak(doc, y, 10, drawSwainFooter);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.text(line, marginL, y);
        y += 4.2;
      }
    }
  } else {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text('-', marginL, y);
    y += 4.2;
  }

  y += 4;
  y = checkPageBreak(doc, y, 12, drawSwainFooter);
  doc.setFont('helvetica', 'bold');
  doc.text(`Dear ${String(f.employeeName || '').trim()},`, marginL, y);
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const designation = String(f.designation || 'Project Associate').trim();
  const offerText = `We would like to inform you that Power Tech Consultants offer you in the position of ${designation} in our company and will be responsible for working on various projects to support our company's growth and success.`;
  const offerLines = doc.splitTextToSize(offerText, contentW) as string[];
  for (const line of offerLines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(line, marginL, y);
    y += 4.5;
  }

  y += 3.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Your role will include the following responsibilities:', marginL, y);
  y += 4.2;

  let respList: string[] = [];
  if (f.responsibilities && String(f.responsibilities).trim()) {
    respList = String(f.responsibilities).split('\n').map((s) => s.trim()).filter(Boolean);
  } else {
    respList = DEFAULT_APPOINTMENT_RESPONSIBILITIES;
  }

  for (const item of respList) {
    const cleanItem = item.replace(/^[-*-\s]+/, '').trim();
    doc.setFont('helvetica', 'normal');
    y = checkPageBreak(doc, y, 12, drawSwainFooter);
    doc.text('\u2022', marginL + 3, y);
    doc.setFont('helvetica', 'normal');
    const rLines = doc.splitTextToSize(cleanItem, contentW - 8) as string[];
    for (let i = 0; i < rLines.length; i++) {
      if (i > 0) {
        y = checkPageBreak(doc, y, 10, drawSwainFooter);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
      }
      doc.text(rLines[i], marginL + 7, y);
      y += 3.8;
    }
  }

  y += 3.5;
  y = checkPageBreak(doc, y, 12, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const commenceDate = fmtOrdinalDate(f.joiningDate || new Date().toISOString());
  const commPrefix = 'Your employment with Power Tech Consultants will commence on ';
  doc.text(commPrefix, marginL, y);
  const commPrefixW = doc.getTextWidth(commPrefix);
  doc.setFont('helvetica', 'bold');
  const cleanCommDate = commenceDate.endsWith('.') ? commenceDate.slice(0, -1) : commenceDate;
  doc.text(`${cleanCommDate}.`, marginL + commPrefixW, y);
  doc.setFont('helvetica', 'normal');
  y += 5;

  y = checkPageBreak(doc, y, 12, drawSwainFooter);
  doc.setFont('helvetica', 'bold');
  doc.text('Terms and Conditions:', marginL, y);
  doc.setFont('helvetica', 'normal');
  y += 4.2;

  let termsList: string[] = [];
  if (f.terms && String(f.terms).trim()) {
    termsList = String(f.terms).split('\n').map((s) => s.trim()).filter(Boolean);
  } else {
    termsList = DEFAULT_APPOINTMENT_TERMS(
      String(f.monthlySalary || 'Rs. 6000/-'),
      String(f.workingHours || '8 hours per day'),
    );
  }

  for (const item of termsList) {
    const cleanItem = item.replace(/^[-*-\s]+/, '').trim();
    doc.setFont('helvetica', 'normal');
    y = checkPageBreak(doc, y, 12, drawSwainFooter);
    doc.text('\u2022', marginL + 3, y);
    doc.setFont('helvetica', 'normal');
    const tLines = doc.splitTextToSize(cleanItem, contentW - 8) as string[];
    for (let i = 0; i < tLines.length; i++) {
      if (i > 0) {
        y = checkPageBreak(doc, y, 10, drawSwainFooter);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
      }
      doc.text(tLines[i], marginL + 7, y);
      y += 3.8;
    }
  }

  y += 3.5;

  const contentItems = getContentParas(f);
  for (const cp of contentItems) {
    y += 2.5;
    const cpLines = doc.splitTextToSize(cp, contentW) as string[];
    for (const l of cpLines) {
      y = checkPageBreak(doc, y, 10, drawSwainFooter);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(l, marginL, y);
      y += 4.5;
    }
  }

  y = checkPageBreak(doc, y, 12, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Thanking you & assuring you of our best professional attention at all times.', marginL, y);
  y += 4.5;
  y = checkPageBreak(doc, y, 10, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Regards', marginL, y);
  y += 4;

  // Page break check before signature block
  if (y > doc.internal.pageSize.getHeight() - 65) {
    doc.addPage();
    y = 25;
  }

  try {
    doc.addImage(SWAIN_SIGNATURE_B64, 'JPEG', marginL, y, 42, 13.2);
    y += 14.5;
  } catch (e) {
    console.error('Signature render error:', e);
    y += 8;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(SWAIN_COMPANY.managerName, marginL, y);
  y += 4;
  // Use manager title from configuration based on document type
  const managerTitle = docConfig.managerTitle === 'manager' 
    ? SWAIN_COMPANY.managerTitle 
    : docConfig.managerTitle === 'hr_admin' 
      ? SWAIN_COMPANY.managerHrTitle 
      : SWAIN_COMPANY.managerHrAdmnTitle;
  doc.text(managerTitle, marginL, y);
  y += 4;
  doc.text(SWAIN_COMPANY.name, marginL, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Corporate Office - ${COMPANY_CONFIG.corporateOffice.address}`, marginL, y);
  y += 3.4;
  doc.text(SWAIN_COMPANY.managerPhone, marginL, y);
  y += 3.4;
  doc.text(SWAIN_COMPANY.managerEmail, marginL, y);
  y += 3.4;
  doc.text(SWAIN_COMPANY.managerWeb, marginL, y);

  drawSwainFooter(doc);
}

// ---------- Swain & Sons Relieving Certificate (PDF) ----------

function buildLeavingCertificate(doc: jsPDF, input: DocumentPdfInput) {
  const f = input.fields;
  const docConfig = getDocumentConfig(input.docType);
  const marginL = 14;
  const marginR = 196;
  const contentW = marginR - marginL;

  drawSwainHeader(doc, docConfig, { accreditation: true });

  // reset header font state so body text never inherits 12pt blue
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  let y = 42;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const refText = input.docNumber ? `Ref: ${input.docNumber}` : 'Ref: SSPTPL/HR /26';
  doc.text(refText, marginL, y);
  
  // Use mixed date format for relieving certificate (ordinal in header, DD.MM.YYYY in signature)
  const dateFormatted = fmtOrdinalDate(input.issueDate || new Date().toISOString());
  doc.text(`Date: ${dateFormatted}`, marginR, y, { align: 'right' });

  y = 48;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('To', marginL, y);
  y += 4.5;

  const rawName = String(f.employeeName || 'Silu Sahoo').trim();
  const salutedName = rawName.startsWith('Mr.') || rawName.startsWith('Ms.') || rawName.startsWith('Mrs.') || rawName.startsWith('Mx.') ? rawName : `${getSalutation(f.gender)} ${rawName}`;
  doc.text(salutedName, marginL, y);
  y += 4.2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  if (f.permanentAddress) {
    const lines = String(f.permanentAddress).split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line) {
        y = checkPageBreak(doc, y, 10, drawSwainFooter);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(line, marginL, y);
        y += 4;
      }
    }
  }

  y = checkPageBreak(doc, y, 10, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Contact No: ${f.phone || ''}`, marginL, y);
  y += 4;
  y = checkPageBreak(doc, y, 10, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Email: ${f.email || ''}`, marginL, y);
  y += 6;

  y = checkPageBreak(doc, y, 12, drawSwainFooter);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const plainName = rawName.replace(/^(Mr\.|Ms\.|Mrs\.|Mx\.)\s*/, '');
  doc.text(`Dear ${plainName},`, marginL, y);
  y += 5.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);

  const resDateStr = fmtOrdinalDate(f.resignationDate || f.relievingDate || input.issueDate);
  const p1 = `This has reference to your resignation letter dated ${resDateStr}. Your resignation is hereby accepted.`;
  const p1Lines = doc.splitTextToSize(p1, contentW) as string[];
  for (const l of p1Lines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(l, marginL, y);
    y += 4.5;
  }
  y += 2.5;

  const relDateStr = fmtOrdinalDate(f.relievingDate || input.issueDate);
  const setDateStr = fmtOrdinalDate(f.settlementDate || f.relievingDate || input.issueDate);
  const p2 = `You shall be relieved from the service on ${relDateStr}. Your full & final Settlement and pending dues shall be cleared by the firm on ${setDateStr}.`;
  const p2Lines = doc.splitTextToSize(p2, contentW) as string[];
  for (const l of p2Lines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(l, marginL, y);
    y += 4.5;
  }
  y += 2.5;

  const tenureStr = f.tenure ? String(f.tenure) : 'last 9 months';
  const p3 = `We thank you for the services rendered by you and contribution made by you in the ${tenureStr} which helped the firm immensely.`;
  const p3Lines = doc.splitTextToSize(p3, contentW) as string[];
  for (const l of p3Lines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(l, marginL, y);
    y += 4.5;
  }
  y += 2.5;

  const p4 = 'We wish you all success in your future endeavors and in your new assignment.';
  const p4Lines = doc.splitTextToSize(p4, contentW) as string[];
  for (const l of p4Lines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(l, marginL, y);
    y += 4.5;
  }
  y += 3.5;

  const contentItemsLeaving = getContentParas(f);
  for (const cp of contentItemsLeaving) {
    y += 2.5;
    const cpLines = doc.splitTextToSize(cp, contentW) as string[];
    for (const l of cpLines) {
      y = checkPageBreak(doc, y, 10, drawSwainFooter);
      doc.text(l, marginL, y);
      y += 4.5;
    }
  }

  y = checkPageBreak(doc, y, 15, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Thanking you,', marginL, y);
  y += 5;
  y = checkPageBreak(doc, y, 15, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Yours Sincerely,', marginL, y);
  y += 5;
  y = checkPageBreak(doc, y, 15, drawSwainFooter);
  doc.setFont('helvetica', 'bold');
  doc.text('For Power Tech Consultants', marginL, y);
  doc.setFont('helvetica', 'normal');
  y += 4;

  // Page break check before signature block
  if (y > doc.internal.pageSize.getHeight() - 55) {
    doc.addPage();
    y = 25;
  }

  try {
    doc.addImage(SWAIN_BLUE_SIG_B64, 'JPEG', marginL, y, 42, 13.2);
    y += 15.5;
  } catch (e) {
    console.error('Signature render error:', e);
    y += 8;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(SWAIN_COMPANY.managerName, marginL, y);
  y += 4;
  // Use HR & Admin title for relieving certificate
  doc.text(SWAIN_COMPANY.managerHrTitle, marginL, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  // Use DD.MM.YYYY format for relieving certificate signature date
  const sigDate = fmtDateDDMMYYYY(input.issueDate || new Date().toISOString());
  doc.text(`Date: ${sigDate}`, marginL, y);

  drawSwainFooter(doc);
}

// ---------- Swain & Sons Experience Certificate (PDF) ----------

function buildExperienceCertificate(doc: jsPDF, input: DocumentPdfInput) {
  const f = input.fields;
  const docConfig = getDocumentConfig(input.docType);
  // reset header font state so body text never inherits 12pt blue
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const marginL = 14;
  const marginR = 196;
  const contentW = marginR - marginL;

  drawSwainHeader(doc, docConfig, { accreditation: false, expPhone: true, expEmail: true });

  // reset header font state so body text never inherits 12pt blue
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  let y = 48;
  // Experience certificates don't have reference numbers, but they do have dates
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const dateFormatted = fmtOrdinalDate(input.issueDate || new Date().toISOString());
  doc.text(`Date: ${dateFormatted}`, marginR, y, { align: 'right' });
  y += 6;
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TO WHOMEVER IT MAY CONCERN', 105, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);

  const rawName = String(f.employeeName || 'Employee').trim();
  const salutedName = rawName.startsWith('Mr.') || rawName.startsWith('Ms.') || rawName.startsWith('Mrs.') || rawName.startsWith('Mx.') ? rawName : `${getSalutation(f.gender)} ${rawName}`;
  const fatherStr = formatParentRelation(f.gender, f.fatherName);
  const addrStr = f.permanentAddress
    ? ` residing at ${String(f.permanentAddress).replace(/\n+/g, ', ')}`
    : '';
  const desigStr = String(f.designation || 'Energy Engineer').trim();
  const fromStr = fmtOrdinalDate(f.employmentFrom || '2018-12-21');
  const toStr = fmtOrdinalDate(f.employmentTo || '2022-01-16');

  const p1 = `This is to certify that, ${salutedName}${fatherStr}${addrStr}, has worked with us as ${desigStr} from ${fromStr} to ${toStr}.`;
  const p1Lines = doc.splitTextToSize(p1, contentW) as string[];
  for (const l of p1Lines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(l, marginL, y);
    y += 5;
  }
  y += 3;

  const projectDesc = f.projectRemarks && String(f.projectRemarks).trim()
    ? String(f.projectRemarks)
    : DEFAULT_EXPERIENCE_PROJECT_REMARKS(salutedName, f.gender);
  const p2Lines = doc.splitTextToSize(projectDesc, contentW) as string[];
  for (const l of p2Lines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(l, marginL, y);
    y += 4.8;
  }
  y += 3;

  const condRemark = f.conductRemark && String(f.conductRemark).trim()
    ? String(f.conductRemark)
    : `${getPronoun(f.gender).subject} is sincere, hardworking, and ${getPronoun(f.gender).possessive} conduct is good.`;
  const p3Lines = doc.splitTextToSize(condRemark, contentW) as string[];
  for (const l of p3Lines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(l, marginL, y);
    y += 4.8;
  }
  y += 3;

  const p4 = `We wish ${getPronoun(f.gender).object} all the best for ${getPronoun(f.gender).possessive} future endeavours.`;
  y = checkPageBreak(doc, y, 20, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(p4, marginL, y);
  y += 8;

  const contentItemsExp = getContentParas(f);
  for (const cp of contentItemsExp) {
    y += 2.5;
    const cpLines = doc.splitTextToSize(cp, contentW) as string[];
    for (const l of cpLines) {
      y = checkPageBreak(doc, y, 10, drawSwainFooter);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(l, marginL, y);
      y += 4.5;
    }
  }

  y = checkPageBreak(doc, y, 15, drawSwainFooter);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('For Power Tech Consultants', marginL, y);
  y += 4;

  // Page break check before signature block
  if (y > doc.internal.pageSize.getHeight() - 55) {
    doc.addPage();
    y = 25;
  }

  try {
    doc.addImage(SWAIN_BLUE_SIG_B64, 'JPEG', marginL, y, 44, 13.9);
    y += 16.5;
  } catch (e) {
    console.error('Signature render error:', e);
    y += 8;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  // Experience certificate uses parentheses around manager name
  doc.text(`(${SWAIN_COMPANY.managerName})`, marginL, y);
  y += 4;
  doc.text(SWAIN_COMPANY.managerTitle, marginL, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const sigDateStr = fmtOrdinalDate(f.signatoryDate || input.issueDate || new Date().toISOString());
  doc.text(`Date: ${sigDateStr}`, marginL, y);
  y += 4;
  doc.text(`Place: ${f.place || 'Bhubaneswar'}`, marginL, y);

  drawSwainFooter(doc);
}

// ---------- Standard Certs PDF Renderers ----------

function buildInternshipCertificate(doc: jsPDF, input: DocumentPdfInput) {
  const f = input.fields;
  const docConfig = getDocumentConfig(input.docType);
  
  // Use Swain letterhead for internship certificate
  drawSwainHeader(doc, docConfig, { accreditation: true });
  // reset header font state so body text never inherits 12pt blue
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  
  const marginL = 14;
  const marginR = 196;
  const contentW = marginR - marginL;
  
  let y = 42;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  
  // Reference number for internship certificate
  if (input.docNumber) {
    const refText = `Ref: ${input.docNumber}`;
    doc.text(refText, marginL, y);
  }
  
  // Date format for internship certificate (DD.MM.YYYY)
  const dateFormatted = fmtOrdinalDate(input.issueDate || new Date().toISOString());
  doc.text(`Date: ${dateFormatted}`, marginR, y, { align: 'right' });
  
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const titleCenterX = doc.internal.pageSize.getWidth() / 2;
  doc.text('TO WHOMEVER IT MAY CONCERN', titleCenterX, y, { align: 'center' });
  y += 8;
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  
  // Build detailed internship certificate text matching actual format
  const rawInternName = String(f.internName || '-').trim();
  const internName = rawInternName.startsWith('Mr.') || rawInternName.startsWith('Ms.') || rawInternName.startsWith('Mrs.') || rawInternName.startsWith('Mx.') ? rawInternName : `${getSalutation(f.gender)} ${rawInternName}`;
  const institution = f.institution || '-';
  const regNumber = f.registrationNumber ? ` bearing Registration No - ${f.registrationNumber}` : '';
  const fatherName = formatParentRelation(f.gender, f.fatherName);
  const domain = f.domain ? ` in the domain of ${String(f.domain).trim()}` : '';
  
  // Use DD.MM.YYYY format for internship dates
  const internshipPeriod = fmtDateRangeDDMMYYYY(f.internshipFrom, f.internshipTo);
  const durationText = formatInternshipDuration(f.internshipFrom, f.internshipTo);
  
  const introText = `This is to certify that ${internName}, a student of ${institution}${regNumber}${fatherName} has served as a full-time intern${domain} in our Company Power Tech Consultants, for a period of ${durationText} i.e. from ${internshipPeriod}.`;
  
  const introLines = doc.splitTextToSize(introText, contentW) as string[];
  for (const line of introLines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(line, marginL, y);
    y += 4.5;
  }
  
  y += 3;
  
  // Performance evaluation text
  const perfText = f.completionRemark && String(f.completionRemark).trim()
    ? String(f.completionRemark)
    : `${getPronoun(f.gender).possessive} contribution is quite valuable for the company. ${getPronoun(f.gender).possessive} interpersonal skills are outstanding and ${getPronoun(f.gender).subject} has been very helpful to the company. ${getPronoun(f.gender).subject} is sincere, hardworking and ${getPronoun(f.gender).possessive} conduct is good.`;
  
  const perfLines = doc.splitTextToSize(perfText, contentW) as string[];
  for (const line of perfLines) {
    y = checkPageBreak(doc, y, 10, drawSwainFooter);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(line, marginL, y);
    y += 4.5;
  }
  
  y += 3;
  y = checkPageBreak(doc, y, 20, drawSwainFooter);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`We wish ${getPronoun(f.gender).object} all success in ${getPronoun(f.gender).possessive} life.`, marginL, y);
  y += 8;

  const contentItemsIntern = getContentParas(f);
  for (const cp of contentItemsIntern) {
    y += 2.5;
    const cpLines = doc.splitTextToSize(cp, contentW) as string[];
    for (const l of cpLines) {
      y = checkPageBreak(doc, y, 10, drawSwainFooter);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(l, marginL, y);
      y += 4.5;
    }
  }
  
  y = checkPageBreak(doc, y, 20, drawSwainFooter);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('For Power Tech Consultants', marginL, y);
  y += 8;

  // Page break check before signature block
  if (y > doc.internal.pageSize.getHeight() - 55) {
    doc.addPage();
    y = 25;
  }

  // Use regular signature for internship certificate
  try {
    doc.addImage(SWAIN_SIGNATURE_B64, 'JPEG', marginL, y, 42, 13.2);
    y += 14.5;
  } catch (e) {
    console.error('Signature render error:', e);
    y += 8;
  }
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(SWAIN_COMPANY.managerName, marginL, y);
  y += 4;
  
  // Use HR & Admn title for internship certificate
  const managerTitle = SWAIN_COMPANY.managerHrAdmnTitle || SWAIN_COMPANY.managerHrTitle;
  doc.text(managerTitle, marginL, y);
  y += 4;
  
  // Use DD.MM.YYYY format for signature date
  // reset header font state so body text never inherits 12pt blue
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const sigDate = fmtDateDDMMYYYY(input.issueDate || new Date().toISOString());
  doc.text(`Date: ${sigDate}`, marginL, y);
  
  drawSwainFooter(doc);
}

function buildSalarySlip(doc: jsPDF, input: DocumentPdfInput) {
  const f = input.fields as Record<string, any>;
  const calc = calcSalarySlip(f);
  const num = (k: string) => Number(f[k] ?? 0) || 0;
  const docConfig = getDocumentConfig('salary_slip');
  const w = doc.internal.pageSize.getWidth();

  drawSwainHeader(doc, docConfig, { accreditation: false });

  // reset header font state so body text never inherits 12pt blue
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  let y = drawTitle(doc, 'Salary Slip', input.issueDate, input.docNumber);

  y = drawKeyValueGrid(
    doc,
    [
      ['Employee Name', f.employeeName ?? ''],
      ['Month & Year', `${f.month ?? '-'} ${f.year ?? ''}`.trim()],
      ['Employee ID', f.employeeId ?? ''],
      ['No. of Days Worked', f.daysWorked ?? ''],
      ['Designation', f.designation ?? ''],
      ['Department / Project', f.department ?? ''],
      ['UAN', f.uan ?? ''],
      ['Date of Joining', f.joiningDate ? fmtDate(f.joiningDate) : ''],
    ],
    y,
  );

  const sectionTitle = (text: string) => {
    y = checkPageBreak(doc, y, SALARY_SECTION_NEEDED, drawSwainFooter);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 32, 96);
    doc.text(text, 14, y);
    doc.setTextColor(0, 0, 0);
    y += 2;
  };

  const boldRow = (cells: (string | number)[]) => cells.map((c) => ({ content: String(c), styles: { fontStyle: 'bold' as const } }));
  const tableOpts = {
    theme: 'grid' as const,
    styles: { fontSize: 7.5, cellPadding: 1.0, lineColor: [183, 180, 204] as [number, number, number], lineWidth: 0.1, textColor: [30, 30, 30] as [number, number, number] },
    headStyles: { fillColor: [233, 228, 245] as [number, number, number], textColor: [30, 30, 60] as [number, number, number], fontStyle: 'bold' as const, fontSize: 8 },
    margin: { left: 14, right: 14 },
    didDrawPage: (data: { pageNumber: number }) => {
      if (data.pageNumber > 1) {
        drawSwainHeader(doc, docConfig, { accreditation: false });
        drawSwainFooter(doc);
      }
    },
  };

  sectionTitle('EARNINGS');
  autoTable(doc, {
    ...tableOpts,
    startY: y,
    head: [['Sl.', 'Particulars', 'Amount']],
    body: [
      ['A', 'Basic Pay', fmtINR(num('basicPay'))],
      ['B', 'Dearness Allowance', fmtINR(num('dearnessAllowance'))],
      boldRow(['C', 'Total (A+B)', fmtINR(calc.epfoBasic)]),
      ['', 'EPFO Basic', fmtINR(calc.epfoBasic)],
      ['D', 'Variable Pay', fmtINR(num('variablePay'))],
      ['E', 'Travelling Allowance', fmtINR(num('travellingAllowance'))],
      ['F', 'House Rent Allowance', fmtINR(num('hra'))],
      ['G', 'Project Allowance', fmtINR(num('projectAllowance'))],
      ['H', 'Responsibility Allowance', fmtINR(num('responsibilityAllowance'))],
      ['M', 'Special Allowance', fmtINR(num('specialAllowance'))],
      ['N', 'Performance Incentive', fmtINR(num('performanceIncentive'))],
      ['O', 'Annual Bonus', fmtINR(num('annualBonus'))],
      ['P', 'Compensatory Allowance', fmtINR(num('compensatoryAllowance'))],
    ],
    columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 130 }, 2: { halign: 'right' } },
  });
  y = ((doc as any)?.lastAutoTable?.finalY ?? y) + 5;

  sectionTitle('DEDUCTIONS & EMPLOYER CONTRIBUTIONS');
  autoTable(doc, {
    ...tableOpts,
    startY: y,
    head: [['Sl.', 'Particulars', 'Rate / Basis', 'Amount']],
    body: [
      ['I', 'Provident Fund', '12% of EPFO Basic', fmtINR(num('pf'))],
      ['J', 'E.S.I.', '0.75% of EPFO Basic', fmtINR(num('esi'))],
      ['K', 'Employer Contribution - PF', '12% of EPFO Basic', fmtINR(num('employerPf'))],
      ['L', 'Employer Contribution - ESI', '3.25% of EPFO Basic', fmtINR(num('employerEsi'))],
    ],
    columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 88 }, 2: { cellWidth: 54 }, 3: { halign: 'right' } },
  });
  y = ((doc as any)?.lastAutoTable?.finalY ?? y) + 5;

  sectionTitle('SALARY SUMMARY');
  autoTable(doc, {
    ...tableOpts,
    startY: y,
    head: [['Sl.', 'Particulars', 'Amount']],
    body: [
      ['Q', 'Gross Total (including Employer Contributions)', fmtINR(calc.grossTotal)],
      ['R', 'Net Total', fmtINR(calc.netTotal)],
      ['S', 'Advance Paid', fmtINR(calc.advancePaid)],
      ['T', 'Excess Leave Deduction', fmtINR(calc.excessLeaveDeduction)],
      boldRow(['U', 'NET PAYABLE', fmtINR(calc.netPayable)]),
    ],
    columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 130 }, 2: { halign: 'right' } },
  });
  let yEnd = ((doc as any).lastAutoTable?.finalY ?? y) + 7;

  // Amount in Words — label bold, value normal
  const amountLabel = 'Amount in Words: ';
  const amountValue = amountInWordsINR(calc.netPayable);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const labelW = doc.getTextWidth(amountLabel);
  const valueLines = doc.splitTextToSize(amountValue, w - 28 - labelW) as string[];
  // First line: label + first value segment; subsequent lines use full width
  const firstValueLines = valueLines.length > 0 ? [valueLines[0]] : [];
  const restValue = amountValue.substring(firstValueLines[0]?.length ?? 0).trim();
  const restLines = restValue ? (doc.splitTextToSize(restValue, w - 28) as string[]) : [];
  const allValueLines = [...firstValueLines, ...restLines];
  for (let i = 0; i < allValueLines.length; i++) {
    yEnd = checkPageBreak(doc, yEnd, 8, drawSwainFooter);
    if (i === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(amountLabel, 14, yEnd);
      doc.setFont('helvetica', 'normal');
      doc.text(allValueLines[i], 14 + labelW, yEnd);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(allValueLines[i], 14, yEnd);
    }
    yEnd += 4.5;
  }
  if (allValueLines.length === 0) {
    yEnd = checkPageBreak(doc, yEnd, 8, drawSwainFooter);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(amountLabel, 14, yEnd);
    yEnd += 4.5;
  }

  // Combined note + footer area - single check
  yEnd = checkPageBreak(doc, yEnd, 20, drawSwainFooter);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text('This is a computer-generated salary slip, so a signature is not required', w / 2, yEnd, { align: 'center' });
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.3);
  doc.line(14, yEnd + 3, w - 14, yEnd + 3);
  doc.setTextColor(0, 0, 0);

  drawSwainFooter(doc);
}

function buildBody(doc: jsPDF, input: DocumentPdfInput) {
  switch (input.docType) {
    case 'appointment_letter':
      return buildAppointmentLetter(doc, input);
    case 'experience_certificate':
      return buildExperienceCertificate(doc, input);
    case 'internship_certificate':
      return buildInternshipCertificate(doc, input);
    case 'leaving_certificate':
      return buildLeavingCertificate(doc, input);
    case 'salary_slip':
      return buildSalarySlip(doc, input);
  }
}

// ---------- public API ----------

export function generateDocumentPdf(input: DocumentPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  if (input.docType === 'appointment_letter') {
    buildAppointmentLetter(doc, input);
  } else if (input.docType === 'leaving_certificate') {
    buildLeavingCertificate(doc, input);
  } else if (input.docType === 'experience_certificate') {
    buildExperienceCertificate(doc, input);
  } else if (input.docType === 'internship_certificate') {
    buildInternshipCertificate(doc, input);
  } else if (input.docType === 'salary_slip') {
    buildSalarySlip(doc, input);
  } else {
    drawLetterhead(doc);
    buildBody(doc, input);
    drawSignature(doc, input.issuedBy);
  }
  return doc;
}

export function downloadDocumentPdf(input: DocumentPdfInput) {
  const doc = generateDocumentPdf(input);
  const name = input.docNumber && input.docNumber !== 'N/A' 
    ? input.docNumber 
    : docTypeLabel(input.docType).replace(/\s+/g, '-');
  doc.save(`${name}.pdf`);
}

export function documentPdfPreviewUrl(input: DocumentPdfInput): string {
  return generateDocumentPdf(input).output('datauristring');
}

export function documentPdfPreviewBlobUrl(input: DocumentPdfInput): string {
  const doc = generateDocumentPdf(input);
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
}

// ---------- DOCX (Word) rendering helpers ----------
import { COMPANY_CONFIG as DOCX_COMPANY_CONFIG } from './companyConfig';
import { getDocumentConfig as getDocxDocumentConfig } from './documentTypeConfig';

const pt = (n: number) => n * 2;

type DocxAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];

interface DocxParaOpts {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  align?: DocxAlignment;
  spacingAfter?: number;
  color?: string;
}

function docxP(text: string, opts: DocxParaOpts = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.spacingAfter ?? 140, line: 280 },
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: pt(opts.size ?? 10), color: opts.color })],
  });
}

function docxBody(text: string, spacingAfter = 180): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: spacingAfter, line: 300 },
    children: [new TextRun({ text, size: pt(9.5) })],
  });
}

function docxSpacer(after = 200): Paragraph {
  return new Paragraph({ spacing: { after }, children: [] });
}

const DOCX_TABLE_BORDERS = (() => {
  const b = { style: BorderStyle.SINGLE, size: 4, color: 'B7B4CC' };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
})();

function docxCell(text: string, opts: { bold?: boolean; fill?: string; widthPct?: number; align?: DocxAlignment } = {}): TableCell {
  return new TableCell({
    width: opts.widthPct !== undefined ? { size: opts.widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [docxP(text, { bold: opts.bold, size: 10, align: opts.align, spacingAfter: 0 })],
  });
}

function docxSalaryHeaderTable(rows: [string, string, string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: DOCX_TABLE_BORDERS,
    rows: rows.map(
      ([k1, v1, k2, v2]) =>
        new TableRow({
          children: [
            docxCell(k1, { bold: true, fill: 'F3F1FA', widthPct: 18 }),
            docxCell(v1, { widthPct: 32 }),
            docxCell(k2, { bold: true, fill: 'F3F1FA', widthPct: 18 }),
            docxCell(v2, { widthPct: 32 }),
          ],
        }),
    ),
  });
}

function docxSalarySectionTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 140, after: 60 },
    children: [new TextRun({ text, bold: true, size: pt(10), color: '002060' })],
  });
}

function docxSalaryTable(
  head: string[],
  rows: { cells: (string | number)[]; bold?: boolean }[],
  widths: number[],
  rightCols: number[],
): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: DOCX_TABLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: head.map((h, i) =>
          docxCell(h, { bold: true, fill: 'E9E4F5', widthPct: widths[i], align: rightCols.includes(i) ? AlignmentType.RIGHT : undefined }),
        ),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.cells.map((c, i) =>
              docxCell(String(c), { bold: r.bold, widthPct: widths[i], align: rightCols.includes(i) ? AlignmentType.RIGHT : undefined }),
            ),
          }),
      ),
    ],
  });
}

function docxLetterhead(): Paragraph[] {
  return [
    docxP(COMPANY.name, { bold: true, size: 18, align: AlignmentType.CENTER, spacingAfter: 60, color: '1F2937' }),
    docxP(COMPANY.address, { size: 9, align: AlignmentType.CENTER, spacingAfter: 40, color: '6B7280' }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '4C1D95', space: 4 } },
      children: [new TextRun({ text: `CIN: ${COMPANY.cin}`, size: pt(8), color: '9CA3AF' })],
    }),
  ];
}

function docxTitleBlock(title: string, issueDate: string, docNumber: string): Paragraph[] {
  return [
    docxP(title, { bold: true, size: 14, align: AlignmentType.CENTER, spacingAfter: 80 }),
    docxP(`Ref No: ${docNumber || '-'}`, { size: 9, align: AlignmentType.RIGHT, spacingAfter: 40, color: '6B7280' }),
    docxP(`Date: ${fmtDate(issueDate)}`, { size: 9, align: AlignmentType.RIGHT, spacingAfter: 280, color: '6B7280' }),
  ];
}

function docxSignature(issuedBy?: string | null): Paragraph[] {
  return [
    docxSpacer(400),
    docxP(`For ${COMPANY.name}`, { align: AlignmentType.RIGHT, spacingAfter: 500 }),
    docxP(issuedBy || 'Authorised Signatory', { bold: true, align: AlignmentType.RIGHT, spacingAfter: 40 }),
    docxP('Authorised Signatory', { size: 9, align: AlignmentType.RIGHT, color: '6B7280', spacingAfter: 300 }),
    docxP('This is a computer generated document and does not require a physical signature.', {
      size: 8,
      italics: true,
      align: AlignmentType.CENTER,
      color: '9CA3AF',
    }),
  ];
}

function docxSwainHeaderTable(docConfig: DocumentTypeConfig, opts: { accreditation?: boolean; expPhone?: boolean; expEmail?: boolean } = {}): Table {
  const logoBytes = Uint8Array.from(atob(b64Raw(POWERTECH_LOGO_B64)), (c) => c.charCodeAt(0));
  const NO_BORDERS = {
    top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  };

  const rightParas: Paragraph[] = [
    docxP('Power Tech Consultants', { bold: true, size: 28, align: AlignmentType.CENTER, color: 'C00000', spacingAfter: 60 }),
  ];

  rightParas.push(
    docxP(`Corporate Office: ${DOCX_COMPANY_CONFIG.corporateOffice.address}`, { size: 12, align: AlignmentType.CENTER, color: '002060', spacingAfter: 30 }),
    docxP(`Phone: ${DOCX_COMPANY_CONFIG.corporateOffice.phones.withWhatsapp.join(', ')}`, { size: 12, align: AlignmentType.CENTER, color: '002060', spacingAfter: 30 }),
    docxP(`Email: ${DOCX_COMPANY_CONFIG.corporateOffice.emails.join(', ')} Website: ${DOCX_COMPANY_CONFIG.corporateOffice.website}`, { size: 12, align: AlignmentType.CENTER, color: '002060', spacingAfter: 40 }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 16, type: WidthType.PERCENTAGE },
            margins: { top: 40, bottom: 40, left: 40, right: 40 },
            children: [
              new Paragraph({
                children: [new ImageRun({ type: 'png', data: logoBytes, transformation: { width: 92, height: 96 } })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 84, type: WidthType.PERCENTAGE },
            margins: { top: 0, bottom: 0, left: 60, right: 0 },
            children: rightParas,
          }),
        ],
      }),
    ],
  });
}

function docxSwainFooter(): Paragraph[] {
  return [
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: '002060' } },
      spacing: { before: 80, after: 10 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Regd. Office: 1/A-6, Swati Villa, Surya Vihar, Link Road, Cuttack - 753012, Odisha', bold: false, size: pt(8), color: '002060' })],
    }),
    docxP(`Phone- ${COMPANY_CONFIG.registeredOffice.phone}`, { size: 8, align: AlignmentType.CENTER, color: '002060', spacingAfter: 10 }),
    docxP(SWAIN_COMPANY.webPortal, { bold: true, size: 9, align: AlignmentType.CENTER, color: 'C00000', spacingAfter: 20 }),
  ];
}

// Custom Swain & Sons Word Renderers
function docxAppointmentLetter(f: Record<string, unknown>, docNumber: string, issueDate: string): (Paragraph | Table)[] {
  const docConfig = getDocxDocumentConfig('appointment_letter');
  const sigBytes = Uint8Array.from(atob(b64Raw(SWAIN_SIGNATURE_B64)), (c) => c.charCodeAt(0));
  
  // Get appropriate manager title based on document type
  const managerTitle = docConfig.managerTitle === 'manager' 
    ? SWAIN_COMPANY.managerTitle 
    : docConfig.managerTitle === 'hr_admin' 
      ? SWAIN_COMPANY.managerHrTitle 
      : SWAIN_COMPANY.managerHrAdmnTitle;

  const NO_BORDERS = {
    top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  };

  const headerTable = docxSwainHeaderTable(docConfig, { accreditation: true });
  const divider = new Paragraph({
    border: { bottom: { style: BorderStyle.DOUBLE, size: 12, color: '002060' } },
    spacing: { after: 140 },
    children: [],
  });

  const refDateTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [docxP(docNumber ? `Ref: ${docNumber}` : 'Ref: SSPT/HR/2024', { bold: true, size: 9, spacingAfter: 120 })],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [docxP(`Date: ${fmtOrdinalDate(issueDate || new Date().toISOString())}`, { bold: true, size: 9, align: AlignmentType.RIGHT, spacingAfter: 120 })],
          }),
        ],
      }),
    ],
  });

  const candidateElements: Paragraph[] = [
    docxP(String(f.employeeName || 'Candidate Name'), { bold: true, size: 9.5, spacingAfter: 20 }),
  ];
  if (f.university) candidateElements.push(docxP(String(f.university), { size: 9, spacingAfter: 20 }));
  if (f.qualification) candidateElements.push(docxP(String(f.qualification), { size: 9, spacingAfter: 20 }));
  if (f.enrolmentNumber) {
    const en = String(f.enrolmentNumber).trim();
    const str = en.toLowerCase().includes('enrolment') || en.toLowerCase().includes('id') ? en : `College Enrolment Number: - ${en}`;
    candidateElements.push(docxP(str, { size: 9, spacingAfter: 40 }));
  }
  candidateElements.push(docxP('Permanent Address', { bold: true, size: 9, spacingAfter: 20 }));

  if (f.permanentAddress) {
    const lines = String(f.permanentAddress).split('\n');
    for (const l of lines) {
      if (l.trim()) candidateElements.push(docxP(l.trim(), { size: 9, spacingAfter: 15 }));
    }
  }

  const salutation = docxP(`Dear ${String(f.employeeName || '').trim()},`, { bold: true, size: 9.5, spacingAfter: 80 });
  const designation = String(f.designation || 'Project Associate').trim();
  const offerPara = docxBody(
    `We would like to inform you that Power Tech Consultants offer you in the position of ${designation} in our company and will be responsible for working on various projects to support our company's growth and success.`,
    120,
  );

  const respHead = docxP('Your role will include the following responsibilities:', { size: 9.5, spacingAfter: 60 });
  const respItems = f.responsibilities && String(f.responsibilities).trim()
    ? String(f.responsibilities).split('\n').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_APPOINTMENT_RESPONSIBILITIES;

  const respParas = respItems.map((item) =>
    new Paragraph({
      bullet: { level: 0 },
      spacing: { after: 40, line: 260 },
      children: [new TextRun({ text: item.replace(/^[-*-\s]+/, ''), size: pt(9) })],
    }),
  );

  const commDate = fmtOrdinalDate(f.joiningDate || new Date().toISOString());
  const commPara = new Paragraph({
    spacing: { after: 120, line: 280 },
    children: [
      new TextRun({ text: 'Your employment with Power Tech Consultants will commence on ', size: pt(9.5) }),
      new TextRun({ text: `${commDate.endsWith('.') ? commDate.slice(0, -1) : commDate}.`, bold: true, size: pt(9.5) }),
    ],
  });

  const termsHead = docxP('Terms and Conditions:', { bold: true, size: 9.5, spacingAfter: 60 });
  const termsItems = f.terms && String(f.terms).trim()
    ? String(f.terms).split('\n').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_APPOINTMENT_TERMS(String(f.monthlySalary || 'Rs. 6000/-'), String(f.workingHours || '8 hours per day'));

  const termsParas = termsItems.map((item) =>
    new Paragraph({
      bullet: { level: 0 },
      spacing: { after: 40, line: 260 },
      children: [new TextRun({ text: item.replace(/^[-*-\s]+/, ''), size: pt(9) })],
    }),
  );

  const contentParas = getContentParas(f).map((p) => docxBody(p, 120));

  const closing = [
    docxP('Thanking you & assuring you of our best professional attention at all times.', { size: 9.5, spacingAfter: 60 }),
    docxP('Regards', { size: 9.5, spacingAfter: 60 }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new ImageRun({ type: 'jpg', data: sigBytes, transformation: { width: 145, height: 46 } })],
    }),
    docxP(SWAIN_COMPANY.managerName, { bold: true, size: 9, spacingAfter: 20 }),
    docxP(managerTitle, { bold: true, size: 9, spacingAfter: 20 }),
    docxP(SWAIN_COMPANY.name, { bold: true, size: 9, spacingAfter: 20 }),
    docxP(`Corporate Office - ${COMPANY_CONFIG.corporateOffice.address}`, { size: 8, spacingAfter: 15 }),
    docxP(SWAIN_COMPANY.managerPhone, { size: 8, spacingAfter: 15 }),
    docxP(SWAIN_COMPANY.managerEmail, { size: 8, spacingAfter: 15 }),
    docxP(SWAIN_COMPANY.managerWeb, { size: 8, spacingAfter: 140 }),
  ];

  return [
    headerTable,
    divider,
    refDateTable,
    ...candidateElements,
    salutation,
    offerPara,
    respHead,
    ...respParas,
    commPara,
    termsHead,
    ...termsParas,
    ...contentParas,
    ...closing,
    ...docxSwainFooter(),
  ];
}

function docxLeavingCertificate(f: Record<string, unknown>, docNumber: string, issueDate: string): (Paragraph | Table)[] {
  const docConfig = getDocxDocumentConfig('leaving_certificate');
  const blueSigBytes = Uint8Array.from(atob(b64Raw(SWAIN_BLUE_SIG_B64)), (c) => c.charCodeAt(0));
  
  // Get appropriate manager title based on document type
  const managerTitle = docConfig.managerTitle === 'manager' 
    ? SWAIN_COMPANY.managerTitle 
    : docConfig.managerTitle === 'hr_admin' 
      ? SWAIN_COMPANY.managerHrTitle 
      : SWAIN_COMPANY.managerHrAdmnTitle;

  const NO_BORDERS = {
    top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  };

  const headerTable = docxSwainHeaderTable(docConfig, { accreditation: true });
  const divider = new Paragraph({
    border: { bottom: { style: BorderStyle.DOUBLE, size: 12, color: '002060' } },
    spacing: { after: 140 },
    children: [],
  });

  const refDateTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [docxP(docNumber ? `Ref: ${docNumber}` : 'Ref: SSPTPL/HR /26', { bold: true, size: 9, spacingAfter: 100 })],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [docxP(`Date: ${fmtOrdinalDate(issueDate || new Date().toISOString())}`, { bold: true, size: 9, align: AlignmentType.RIGHT, spacingAfter: 100 })],
          }),
        ],
      }),
    ],
  });

  const rawName = String(f.employeeName || 'Silu Sahoo').trim();
  const salutedName = rawName.startsWith('Mr.') || rawName.startsWith('Ms.') || rawName.startsWith('Mrs.') || rawName.startsWith('Mx.') ? rawName : `${getSalutation(f.gender)} ${rawName}`;
  const plainName = rawName.replace(/^(Mr\.|Ms\.|Mrs\.|Mx\.)\s*/, '');

  const recipientLines: Paragraph[] = [
    docxP('To', { bold: true, size: 9.5, spacingAfter: 20 }),
    docxP(salutedName, { bold: true, size: 9.5, spacingAfter: 20 }),
  ];

  if (f.permanentAddress) {
    const lines = String(f.permanentAddress).split('\n');
    for (const l of lines) {
      if (l.trim()) recipientLines.push(docxP(l.trim(), { size: 9, spacingAfter: 15 }));
    }
  }

  recipientLines.push(
    docxP(`Contact No: ${f.phone || ''}`, { size: 9, spacingAfter: 15 }),
    docxP(`Email: ${f.email || ''}`, { size: 9, spacingAfter: 80 }),
  );

  const resDateStr = fmtOrdinalDate(f.resignationDate || f.relievingDate || issueDate);
  const relDateStr = fmtOrdinalDate(f.relievingDate || issueDate);
  const setDateStr = fmtOrdinalDate(f.settlementDate || f.relievingDate || issueDate);
  const tenureStr = f.tenure ? String(f.tenure) : 'last 9 months';

  const bodyElements: Paragraph[] = [
    docxP(`Dear ${plainName},`, { bold: true, size: 9.5, spacingAfter: 80 }),
    docxBody(`This has reference to your resignation letter dated ${resDateStr}. Your resignation is hereby accepted.`, 120),
    docxBody(`You shall be relieved from the service on ${relDateStr}. Your full & final Settlement and pending dues shall be cleared by the firm on ${setDateStr}.`, 120),
    docxBody(`We thank you for the services rendered by you and contribution made by you in the ${tenureStr} which helped the firm immensely.`, 120),
    docxBody('We wish you all success in your future endeavors and in your new assignment.', 140),
    ...getContentParas(f).map((p) => docxBody(p, 120)),
    docxP('Thanking you,', { size: 9.5, spacingAfter: 40 }),
    docxP('Yours Sincerely,', { size: 9.5, spacingAfter: 40 }),
    docxP('For Power Tech Consultants', { bold: true, size: 9.5, spacingAfter: 40 }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new ImageRun({ type: 'jpg', data: blueSigBytes, transformation: { width: 145, height: 46 } })],
    }),
    docxP(SWAIN_COMPANY.managerName, { bold: true, size: 9, spacingAfter: 20 }),
    // Use manager title from configuration based on document type
    docxP(managerTitle, { bold: true, size: 9, spacingAfter: 20 }),
    // Use DD.MM.YYYY format for relieving certificate
    docxP(`Date: ${fmtDateDDMMYYYY(issueDate || new Date().toISOString())}`, { size: 8.5, spacingAfter: 140 }),
  ];

  return [
    headerTable,
    divider,
    refDateTable,
    ...recipientLines,
    ...bodyElements,
    ...docxSwainFooter(),
  ];
}

function docxExperienceCertificate(f: Record<string, unknown>, docNumber: string, issueDate: string): (Paragraph | Table)[] {
  const docConfig = getDocxDocumentConfig('experience_certificate');
  const blueSigBytes = Uint8Array.from(atob(b64Raw(SWAIN_BLUE_SIG_B64)), (c) => c.charCodeAt(0));
  
  // Get appropriate manager title based on document type
  const managerTitle = docConfig.managerTitle === 'manager' 
    ? SWAIN_COMPANY.managerTitle 
    : docConfig.managerTitle === 'hr_admin' 
      ? SWAIN_COMPANY.managerHrTitle 
      : SWAIN_COMPANY.managerHrAdmnTitle;

  const headerTable = docxSwainHeaderTable(docConfig, { accreditation: false, expPhone: true, expEmail: true });
  const divider = new Paragraph({
    border: { bottom: { style: BorderStyle.DOUBLE, size: 12, color: '002060' } },
    spacing: { after: 140 },
    children: [],
  });

  const rawName = String(f.employeeName || 'Employee').trim();
  const salutedName = rawName.startsWith('Mr.') || rawName.startsWith('Ms.') || rawName.startsWith('Mrs.') || rawName.startsWith('Mx.') ? rawName : `${getSalutation(f.gender)} ${rawName}`;
  const fatherStr = formatParentRelation(f.gender, f.fatherName);
  const addrStr = f.permanentAddress
    ? ` residing at ${String(f.permanentAddress).replace(/\n+/g, ', ')}`
    : '';
  const desigStr = String(f.designation || 'Energy Engineer').trim();
  const fromStr = fmtOrdinalDate(f.employmentFrom || '2018-12-21');
  const toStr = fmtOrdinalDate(f.employmentTo || '2022-01-16');

  const p1 = `This is to certify that, ${salutedName}${fatherStr}${addrStr}, has worked with us as ${desigStr} from ${fromStr} to ${toStr}.`;
  const projectDesc = f.projectRemarks && String(f.projectRemarks).trim()
    ? String(f.projectRemarks)
    : DEFAULT_EXPERIENCE_PROJECT_REMARKS(salutedName, f.gender);
  const condRemark = f.conductRemark && String(f.conductRemark).trim()
    ? String(f.conductRemark)
    : `${getPronoun(f.gender).subject} is sincere, hardworking, and ${getPronoun(f.gender).possessive} conduct is good.`;

  const sigDateStr = fmtOrdinalDate(f.signatoryDate || issueDate || new Date().toISOString());

  const elements: Paragraph[] = [
    docxP('TO WHOMEVER IT MAY CONCERN', { bold: true, size: 11, align: AlignmentType.CENTER, spacingAfter: 140 }),
    docxBody(p1, 140),
    docxBody(projectDesc, 140),
    docxBody(condRemark, 140),
    docxBody(`We wish ${getPronoun(f.gender).object} all the best for ${getPronoun(f.gender).possessive} future endeavours.`, 160),
    ...getContentParas(f).map((p) => docxBody(p, 120)),
    docxP('For Power Tech Consultants', { bold: true, size: 9.5, spacingAfter: 40 }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new ImageRun({ type: 'jpg', data: blueSigBytes, transformation: { width: 145, height: 46 } })],
    }),
    docxP(`(${SWAIN_COMPANY.managerName})`, { bold: true, size: 9, spacingAfter: 20 }),
    // Use manager title from configuration based on document type
    docxP(managerTitle, { bold: true, size: 9, spacingAfter: 20 }),
    docxP(`Date: ${sigDateStr}`, { bold: true, size: 9, spacingAfter: 20 }),
    docxP(`Place: ${f.place || 'Bhubaneswar'}`, { bold: true, size: 9, spacingAfter: 140 }),
  ];

  return [
    headerTable,
    divider,
    ...elements,
    ...docxSwainFooter(),
  ];
}

function docxInternshipCertificate(f: Record<string, unknown>, docNumber: string, issueDate: string): (Paragraph | Table)[] {
  const docConfig = getDocxDocumentConfig('internship_certificate');
  const sigBytes = Uint8Array.from(atob(b64Raw(SWAIN_SIGNATURE_B64)), (c) => c.charCodeAt(0));
  
  // Get appropriate manager title based on document type
  const managerTitle = docConfig.managerTitle === 'manager' 
    ? SWAIN_COMPANY.managerTitle 
    : docConfig.managerTitle === 'hr_admin' 
      ? SWAIN_COMPANY.managerHrTitle 
      : SWAIN_COMPANY.managerHrAdmnTitle;

  const NO_BORDERS = {
    top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  };

  const headerTable = docxSwainHeaderTable(docConfig, { accreditation: true });
  const divider = new Paragraph({
    border: { bottom: { style: BorderStyle.DOUBLE, size: 12, color: '002060' } },
    spacing: { after: 140 },
    children: [],
  });

  const refDateTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [docxP(docNumber ? `Ref: ${docNumber}` : 'Ref: SSPTPL/HR /25', { bold: true, size: 9, spacingAfter: 100 })],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [docxP(`Date: ${fmtOrdinalDate(issueDate || new Date().toISOString())}`, { bold: true, size: 9, align: AlignmentType.RIGHT, spacingAfter: 100 })],
          }),
        ],
      }),
    ],
  });

  // Build detailed internship certificate text matching actual format
  const rawInternName = String(f.internName || '-').trim();
  const docxInternName = rawInternName.startsWith('Mr.') || rawInternName.startsWith('Ms.') || rawInternName.startsWith('Mrs.') || rawInternName.startsWith('Mx.') ? rawInternName : `${getSalutation(f.gender)} ${rawInternName}`;
  const institution = f.institution || '-';
  const regNumber = f.registrationNumber ? ` bearing Registration No - ${f.registrationNumber}` : '';
  const fatherName = formatParentRelation(f.gender, f.fatherName);
  const domain = f.domain ? ` in the domain of ${String(f.domain).trim()}` : '';
  const internshipPeriod = fmtDateRangeDDMMYYYY(f.internshipFrom, f.internshipTo);

  const introText = `This is to certify that ${docxInternName}, a student of ${institution}${regNumber}${fatherName} has served as a full-time intern${domain} in our Company Power Tech Consultants, for a period of ${formatInternshipDuration(f.internshipFrom, f.internshipTo)} i.e. from ${internshipPeriod}.`;

  const perfText = f.completionRemark && String(f.completionRemark).trim()
    ? String(f.completionRemark)
    : `${getPronoun(f.gender).possessive} contribution is quite valuable for the company. ${getPronoun(f.gender).possessive} interpersonal skills are outstanding and ${getPronoun(f.gender).subject} has been very helpful to the company. ${getPronoun(f.gender).subject} is sincere, hardworking and ${getPronoun(f.gender).possessive} conduct is good.`;

  const elements: Paragraph[] = [
    docxP('TO WHOMEVER IT MAY CONCERN', { bold: true, size: 11, align: AlignmentType.CENTER, spacingAfter: 140 }),
    docxBody(introText),
    docxBody(perfText),
    docxBody(`We wish ${getPronoun(f.gender).object} all success in ${getPronoun(f.gender).possessive} life.`),
    ...getContentParas(f).map((p) => docxBody(p, 120)),
    docxSpacer(200),
    docxP('For Power Tech Consultants', { bold: true, size: 9.5, spacingAfter: 40 }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new ImageRun({ type: 'jpg', data: sigBytes, transformation: { width: 145, height: 46 } })],
    }),
    docxP(SWAIN_COMPANY.managerName, { bold: true, size: 9, spacingAfter: 20 }),
    // Use manager title from configuration based on document type
    docxP(managerTitle, { bold: true, size: 9, spacingAfter: 20 }),
    // Use DD.MM.YYYY format for signature date
    docxP(`Date: ${fmtDateDDMMYYYY(issueDate || new Date().toISOString())}`, { size: 8.5, spacingAfter: 140 }),
  ];

  return [
    headerTable,
    divider,
    refDateTable,
    ...elements,
    ...docxSwainFooter(),
  ];
}

function docxSalarySlip(f: Record<string, any>): (Paragraph | Table)[] {
  const num = (k: string) => Number(f[k] ?? 0) || 0;
  const calc = calcSalarySlip(f);

  const headerTable = docxSalaryHeaderTable([
    ['Employee Name', String(f.employeeName ?? '-'), 'Month & Year', `${f.month ?? '-'} ${f.year ?? ''}`.trim()],
    ['Employee ID', String(f.employeeId ?? '-'), 'No. of Days Worked', String(f.daysWorked ?? '-')],
    ['Designation', String(f.designation ?? '-'), 'Department / Project', String(f.department ?? '-')],
    ['UAN', String(f.uan ?? '-'), 'Date of Joining', f.joiningDate ? fmtDate(f.joiningDate) : '-'],
  ]);

  return [
    headerTable,
    docxSpacer(160),
    docxSalarySectionTitle('EARNINGS'),
    docxSalaryTable(
      ['Sl.', 'Particulars', 'Amount'],
      [
        { cells: ['A', 'Basic Pay', fmtINR(num('basicPay'))] },
        { cells: ['B', 'Dearness Allowance', fmtINR(num('dearnessAllowance'))] },
        { cells: ['C', 'Total (A+B)', fmtINR(calc.epfoBasic)], bold: true },
        { cells: ['', 'EPFO Basic', fmtINR(calc.epfoBasic)] },
        { cells: ['D', 'Variable Pay', fmtINR(num('variablePay'))] },
        { cells: ['E', 'Travelling Allowance', fmtINR(num('travellingAllowance'))] },
        { cells: ['F', 'House Rent Allowance', fmtINR(num('hra'))] },
        { cells: ['G', 'Project Allowance', fmtINR(num('projectAllowance'))] },
        { cells: ['H', 'Responsibility Allowance', fmtINR(num('responsibilityAllowance'))] },
        { cells: ['M', 'Special Allowance', fmtINR(num('specialAllowance'))] },
        { cells: ['N', 'Performance Incentive', fmtINR(num('performanceIncentive'))] },
        { cells: ['O', 'Annual Bonus', fmtINR(num('annualBonus'))] },
        { cells: ['P', 'Compensatory Allowance', fmtINR(num('compensatoryAllowance'))] },
      ],
      [10, 60, 30],
      [2],
    ),
    docxSalarySectionTitle('DEDUCTIONS & EMPLOYER CONTRIBUTIONS'),
    docxSalaryTable(
      ['Sl.', 'Particulars', 'Rate / Basis', 'Amount'],
      [
        { cells: ['I', 'Provident Fund', '12% of EPFO Basic', fmtINR(num('pf'))] },
        { cells: ['J', 'E.S.I.', '0.75% of EPFO Basic', fmtINR(num('esi'))] },
        { cells: ['K', 'Employer Contribution - PF', '12% of EPFO Basic', fmtINR(num('employerPf'))] },
        { cells: ['L', 'Employer Contribution - ESI', '3.25% of EPFO Basic', fmtINR(num('employerEsi'))] },
      ],
      [10, 45, 27, 18],
      [3],
    ),
    docxSalarySectionTitle('SALARY SUMMARY'),
    docxSalaryTable(
      ['Sl.', 'Particulars', 'Amount'],
      [
        { cells: ['Q', 'Gross Total (including Employer Contributions)', fmtINR(calc.grossTotal)] },
        { cells: ['R', 'Net Total', fmtINR(calc.netTotal)] },
        { cells: ['S', 'Advance Paid', fmtINR(calc.advancePaid)] },
        { cells: ['T', 'Excess Leave Deduction', fmtINR(calc.excessLeaveDeduction)] },
        { cells: ['U', 'NET PAYABLE', fmtINR(calc.netPayable)], bold: true },
      ],
      [10, 60, 30],
      [2],
    ),
    docxSpacer(120),
    docxP(`Amount in Words: ${amountInWordsINR(calc.netPayable)}`, { bold: true, size: 9, spacingAfter: 220 }),
    docxP('This is a computer-generated salary slip, so a signature is not required', { size: 7.5, italics: true, align: AlignmentType.CENTER, color: '787878', spacingAfter: 60 }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF' } },
      spacing: { after: 0 },
    }),
  ];
}

function docxBuildBody(docType: DocumentDocType, f: Record<string, unknown>, docNumber: string, issueDate: string): (Paragraph | Table)[] {
  switch (docType) {
    case 'internship_certificate':
      return docxInternshipCertificate(f, docNumber, issueDate);
    case 'salary_slip':
      return docxSalarySlip(f);
    default:
      return [];
  }
}

export async function generateDocumentDocxBlob(input: DocumentRenderInput): Promise<Blob> {
  let children: (Paragraph | Table)[];
  const isSwain = input.docType === 'appointment_letter' || input.docType === 'leaving_certificate' || input.docType === 'experience_certificate' || input.docType === 'internship_certificate' || input.docType === 'salary_slip';

  if (input.docType === 'appointment_letter') {
    children = docxAppointmentLetter(input.fields, input.docNumber, input.issueDate);
  } else if (input.docType === 'leaving_certificate') {
    children = docxLeavingCertificate(input.fields, input.docNumber, input.issueDate);
  } else if (input.docType === 'experience_certificate') {
    children = docxExperienceCertificate(input.fields, input.docNumber, input.issueDate);
  } else if (input.docType === 'internship_certificate') {
    children = docxInternshipCertificate(input.fields, input.docNumber, input.issueDate);
  } else if (input.docType === 'salary_slip') {
    children = [
      docxSwainHeaderTable(getDocumentConfig('salary_slip'), { accreditation: false }),
      ...docxTitleBlock('Salary Slip', input.issueDate, input.docNumber),
      ...docxSalarySlip(input.fields),
      ...docxSwainFooter(),
    ];
  } else {
    children = [
      ...docxLetterhead(),
      ...docxTitleBlock(docTypeLabel(input.docType), input.issueDate, input.docNumber),
      ...docxBuildBody(input.docType, input.fields, input.docNumber, input.issueDate),
      ...docxSignature(input.issuedBy),
    ];
  }

  const doc = new DocxDocument({
    styles: { default: { document: { run: { font: 'Calibri', size: pt(isSwain ? 9.5 : 11) } } } },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,  // A4 width in twips (8.27 inches * 1440 twips/inch)
              height: 16838, // A4 height in twips (11.69 inches * 1440 twips/inch)
            },
            margin: isSwain
              ? { top: 500, bottom: 500, left: 720, right: 720 }
              : { top: 720, bottom: 720, left: 900, right: 900 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}

export async function downloadDocumentDoc(input: DocumentRenderInput): Promise<void> {
  const blob = await generateDocumentDocxBlob(input);
  const name = input.docNumber || docTypeLabel(input.docType).replace(/\s+/g, '-');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
