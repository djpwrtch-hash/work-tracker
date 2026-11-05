// nodemailer v10 ships no bundled TypeScript types, and the published @types/nodemailer
// package still targets the v6 `lib/*` layout. These declarations cover the small
// surface this project uses (createTransport + sendMail).
declare module 'nodemailer' {
  namespace nodemailer {
    interface TransportOptions {
      host?: string;
      port?: number;
      secure?: boolean;
      auth?: { user: string; pass: string } | undefined;
    }

    interface SendMailOptions {
      from: string;
      to: string;
      subject: string;
      html: string;
      text?: string;
    }

    interface Transporter {
      sendMail(options: SendMailOptions): Promise<unknown>;
    }
  }

  const nodemailer: {
    createTransport(options: nodemailer.TransportOptions): nodemailer.Transporter;
  };

  export = nodemailer;
}
