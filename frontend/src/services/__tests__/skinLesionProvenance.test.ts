import { hasVerifiedSkinPrediction, supportedModel, type SkinLesionAnalysis } from '../../types/skinLesion.ts';
import { parseSkinLesionResponse } from '../skinLesionJson.ts';

const probabilities = { akiec: 0, bcc: 0.1, bkl: 0.1, df: 0, mel: 0.1, nv: 0.7, vasc: 0 };
const fixture: SkinLesionAnalysis = {
  id: 'fixture', patient_profile_id: 'fixture-patient', predicted_class: 'nv', predicted_label: 'Melanocytic nevi',
  confidence: 0.7, probabilities, risk_level: null, disclaimer: 'Fixture', created_at: '2026-01-01T00:00:00Z',
  inference_mode: 'pytorch_efficientnet_b0', model_version: supportedModel.version, checkpoint_sha256: supportedModel.sha256,
};
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); }
check(hasVerifiedSkinPrediction(fixture), 'complete seven-class prediction with measured zeros');
for (const override of [
  { inference_mode: 'unknown' }, { inference_mode: undefined }, { checkpoint_sha256: undefined },
  { model_version: '' }, { predicted_label: null }, { predicted_label: 'Melanoma' },
  { predicted_class: 'mel' }, { confidence: NaN }, { confidence: 0.69 },
  { probabilities: {nv:0.7} }, { probabilities:{...probabilities,other:0} },
  { probabilities:{...probabilities,df:0.01} },
  ...[NaN,Infinity,-0.01,1.01].map(df=>({probabilities:{...probabilities,df}})),
] satisfies Partial<SkinLesionAnalysis>[]) check(!hasVerifiedSkinPrediction({...fixture,...override}), 'invalid result accepted');
check(hasVerifiedSkinPrediction({...fixture, probabilities:{...probabilities,df:0.0000005}}), 'float tolerance');
const tied = {...probabilities,bcc:0.4,nv:0.4};
check(!hasVerifiedSkinPrediction({...fixture,confidence:0.4,probabilities:tied}), 'tie must follow canonical order');
check(hasVerifiedSkinPrediction({...fixture,confidence:0.4,predicted_class:'bcc',predicted_label:'Basal cell carcinoma',probabilities:tied}), 'canonical tie');
for(const raw of ['{"probabilities":{"nv":0,"nv":1}}','{"items":[{"probabilities":{"nv":0,"\\u006ev":1}}]}']){
  let rejected=false;
  try { parseSkinLesionResponse(raw); } catch { rejected=true; }
  check(rejected,'duplicate wire key accepted');
}
check(parseSkinLesionResponse('{"items":[{"nv":1},{"nv":2}],"note":"{\\"nv\\":1}"}'), 'independent objects');
console.log('Seven-class score, raw response and provenance checks passed');
