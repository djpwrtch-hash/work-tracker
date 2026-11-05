import { describe, expect, it } from 'vitest';
import {
  getSalutation,
  getPronoun,
  fmtINR,
  amountInWordsINR,
  calcSalarySlip,
  generateDocumentPdf,
  type DocumentPdfInput,
} from './documentTemplates';

describe('getSalutation', () => {
  it('returns Mr. for male and unknown input', () => {
    expect(getSalutation('male')).toBe('Mr.');
    expect(getSalutation(undefined)).toBe('Mr.');
    expect(getSalutation('')).toBe('Mr.');
  });

  it('returns Ms. for female', () => {
    expect(getSalutation('female')).toBe('Ms.');
    expect(getSalutation('Female')).toBe('Ms.');
  });

  it('returns Mx. for other', () => {
    expect(getSalutation('other')).toBe('Mx.');
  });
});

describe('getPronoun', () => {
  it('returns He/his/him by default', () => {
    expect(getPronoun('male')).toEqual({ subject: 'He', possessive: 'his', object: 'him' });
    expect(getPronoun(undefined)).toEqual({ subject: 'He', possessive: 'his', object: 'him' });
  });

  it('returns She/her/her for female (Subhasmita case)', () => {
    expect(getPronoun('female')).toEqual({ subject: 'She', possessive: 'her', object: 'her' });
  });

  it('returns They/their/them for other', () => {
    expect(getPronoun('other')).toEqual({ subject: 'They', possessive: 'their', object: 'them' });
  });
});

describe('fmtINR', () => {
  it('formats with Indian grouping and 2 decimals', () => {
    expect(fmtINR(50000)).toBe('Rs. 50,000.00');
    expect(fmtINR(0)).toBe('Rs. 0.00');
    expect(fmtINR(undefined)).toBe('Rs. 0.00');
  });
});

describe('amountInWordsINR', () => {
  it('handles zero', () => {
    expect(amountInWordsINR(0)).toBe('Rupees Zero Only.');
  });

  it('converts thousands with Indian grouping words', () => {
    expect(amountInWordsINR(50000)).toBe('Rupees Fifty Thousand Only.');
  });

  it('converts lakhs and crores (huge salary case)', () => {
    expect(amountInWordsINR(12345678)).toContain('Crore');
    expect(amountInWordsINR(12345678)).toContain('Lakh');
    expect(amountInWordsINR(12345678).endsWith('Only.')).toBe(true);
  });

  it('handles paise and negatives', () => {
    expect(amountInWordsINR(100.5)).toContain('Paise');
    expect(amountInWordsINR(-500)).toContain('Minus');
  });
});

describe('calcSalarySlip', () => {
  it('computes totals from components', () => {
    const calc = calcSalarySlip({
      basicPay: 50000,
      dearnessAllowance: 20000,
      hra: 8000,
      pf: 8640,
      esi: 1296,
      employerPf: 8640,
      employerEsi: 2808,
      advancePaid: 10000,
      excessLeaveDeduction: 5000,
    });
    expect(calc.epfoBasic).toBe(70000);
    expect(calc.totalEarnings).toBe(78000);
    expect(calc.employeeDeductions).toBe(9936);
    expect(calc.employerContributions).toBe(11448);
    expect(calc.grossTotal).toBe(89448);
    expect(calc.netTotal).toBe(68064);
    expect(calc.netPayable).toBe(53064);
  });

  it('treats missing fields as zero', () => {
    const calc = calcSalarySlip({});
    expect(calc.netPayable).toBe(0);
    expect(calc.grossTotal).toBe(0);
  });
});

const baseFields: Record<string, Record<string, unknown>> = {
  appointment_letter: {
    employeeName: 'Test Candidate',
    gender: 'female',
    designation: 'Project Associate',
    university: 'Test University',
    qualification: 'B.Tech',
    enrolmentNumber: '2001229166',
    permanentAddress: 'At- Test Street\nTest City',
    joiningDate: '2024-02-22',
    monthlySalary: 'Rs. 6000/-',
    workingHours: '8 hours per day',
  },
  leaving_certificate: {
    employeeName: 'Test Employee',
    gender: 'female',
    permanentAddress: 'At- Test Street',
    phone: '9937112760',
    email: 'test@example.com',
    resignationDate: '2024-01-10',
    relievingDate: '2024-01-31',
    settlementDate: '2024-02-05',
    tenure: 'last 12 months',
  },
  experience_certificate: {
    employeeName: 'Subhasmita Priyadarsani Bhukta',
    gender: 'female',
    designation: 'Marketing Executive',
    employmentFrom: '2021-11-23',
    employmentTo: '2022-01-16',
    permanentAddress: 'At- Test Street',
    place: 'Bhubaneswar',
  },
  internship_certificate: {
    internName: 'Intern Name',
    gender: 'female',
    institution: 'Test University',
    registrationNumber: 'REG123',
    fatherName: 'Mr. Father',
    domain: 'Energy Auditing',
    internshipFrom: '2024-01-01',
    internshipTo: '2024-01-31',
  },
  salary_slip: {
    employeeName: 'Test Employee',
    employeeId: 'EMP001',
    designation: 'Energy Engineer',
    department: 'Projects',
    month: 'January',
    year: 2024,
    daysWorked: 30,
    uan: '123456789012',
    joiningDate: '2021-11-23',
    basicPay: 50000,
    dearnessAllowance: 20000,
    pf: 8640,
    esi: 1296,
    employerPf: 8640,
    employerEsi: 2808,
  },
};

function makeInput(docType: DocumentPdfInput['docType']): DocumentPdfInput {
  return {
    docType,
    fields: baseFields[docType],
    docNumber: 'TEST-001',
    issueDate: '2024-01-31T00:00:00.000Z',
    issuedBy: null,
  };
}

describe('generateDocumentPdf', () => {
  const types: DocumentPdfInput['docType'][] = [
    'appointment_letter',
    'leaving_certificate',
    'experience_certificate',
    'internship_certificate',
    'salary_slip',
  ];

  for (const docType of types) {
    it(`generates ${docType} on A4 with footer`, () => {
      const doc = generateDocumentPdf(makeInput(docType));
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
      // A4: 210 x 297 mm
      expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
      expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0);
      const raw = doc.output();
      expect(raw).toContain('www.powerbazar.in');
      expect(raw).toContain('Power Tech Consultants');
    });
  }

  it('paginates the salary slip cleanly with footer and note', () => {
    for (const fields of [
      baseFields.salary_slip,
      { ...baseFields.salary_slip, basicPay: 0, dearnessAllowance: 0, pf: 0, esi: 0, employerPf: 0, employerEsi: 0 },
    ]) {
      const doc = generateDocumentPdf({
        docType: 'salary_slip',
        fields,
        docNumber: 'TEST-001',
        issueDate: '2024-01-31T00:00:00.000Z',
        issuedBy: null,
      });
      expect(doc.getNumberOfPages()).toBeLessThanOrEqual(2);
      const raw = doc.output();
      expect(raw).toContain('www.powerbazar.in');
      expect(raw).toContain('computer-generated salary slip');
    }
  });

  it('keeps footer and amount-in-words on a full salary slip', () => {
    const doc = generateDocumentPdf(makeInput('salary_slip'));
    const raw = doc.output();
    expect(raw).toContain('www.powerbazar.in');
    expect(raw).toContain('Amount in Words:');
  });

  it('renders female pronouns for the Subhasmita experience case', () => {
    const doc = generateDocumentPdf(makeInput('experience_certificate'));
    const raw = doc.output();
    expect(raw).toContain('Ms. Subhasmita Priyadarsani Bhukta');
    expect(raw).not.toContain('Mr. Subhasmita');
  });
});
