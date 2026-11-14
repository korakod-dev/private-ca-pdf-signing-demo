// /guide (spec 7.6 page 4, mission M1): why the Root fingerprint must be compared through another channel, a practice box
// that checks what the learner types, and illustrated install steps for Keychain and Adobe (schematic drawings).
import { Card, LayeredContent } from '../components';
import { getMarkdown as getInfoMarkdown } from './info/content';
import { TID } from '../contracts/testids';
import { FingerprintPractice } from './guide/FingerprintPractice';
import { ADOBE_STEPS, KEYCHAIN_STEPS, StepCards } from './guide/StepCards';

export function GuidePage() {
  return (
    <section data-testid={TID.page('guide')} className="space-y-6">
      <h1 className="text-2xl font-bold">คู่มือและ Root CA</h1>

      <Card title="ทำไมต้องเทียบ fingerprint" headingLevel={2}>
        <LayeredContent markdown={getInfoMarkdown('guide/why-fingerprint')} />
      </Card>

      <FingerprintPractice />

      <Card title="ติดตั้ง Root บน Mac (Keychain)" headingLevel={2}>
        <LayeredContent markdown={getInfoMarkdown('guide/install-keychain')} />
        <div className="mt-3">
          <StepCards steps={KEYCHAIN_STEPS} label="ขั้นตอนติดตั้งใน Keychain" />
        </div>
      </Card>

      <Card title="ติดตั้ง Root ใน Adobe Acrobat" headingLevel={2}>
        <LayeredContent markdown={getInfoMarkdown('guide/install-adobe')} />
        <div className="mt-3">
          <StepCards steps={ADOBE_STEPS} label="ขั้นตอนติดตั้งใน Adobe" />
        </div>
      </Card>
    </section>
  );
}
