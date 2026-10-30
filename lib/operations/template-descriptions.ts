import type { CatalogTemplate } from './types';

// Reviewed against these exact supplied master revisions. An updated master needs a new review.
const VERIFIED_DESCRIPTIONS: Record<string, {sourceHash: string; description: string}> = {
  "d023": {
    "sourceHash": "ee140d2782507af5407704cff2a72a325b614acd72cc59c57263b1b49a9394bb",
    "description": "Healthcare for government employees, with annual payment under the BureauHealth 4,250 plan."
  },
  "d024": {
    "sourceHash": "810d84851532297d85ff3ecd24fa843c93663e4f49e8c8f10396805da1d92a86",
    "description": "Healthcare for government employees, with principal and dependent premiums. Standard 7K & 5K variant."
  },
  "d025": {
    "sourceHash": "3bdec5efa8323c54ed07d9ca2e2b0ee48224391251778ca386242bbf59392822",
    "description": "Healthcare for government employees. This 7K & 5K variant covers pre-existing conditions and dreaded diseases, subject to the proposal terms."
  },
  "d026": {
    "sourceHash": "9b11a70ed295889fa8f4b9ff1edafad0925992544c475cf8b17bec58730ddd28",
    "description": "Healthcare for government employees. This 7K & 5K variant covers pre-existing conditions, subject to the proposal terms."
  },
  "d097": {
    "sourceHash": "58d86407e061be91843daefcbe90c6e1926de865091ff9c69f4c321061a2c041",
    "description": "Healthcare for DepEd employees, with a semiannual outpatient limit and annual quoted premiums."
  },
  "d054": {
    "sourceHash": "7a200317938e0d45acb050b8de61fa8b88deafd3ed37b020f04d3862edb9d3e4",
    "description": "Employee healthcare with preventive, outpatient, hospital and emergency services. Standard variant."
  },
  "d055": {
    "sourceHash": "e7f7be0acb300962414f4187dc8263f80402a4d9568658ad617dd2bfdd51e765",
    "description": "Employee healthcare with preventive, outpatient, hospital and emergency services. Variant covering pre-existing conditions and dreaded diseases, subject to the proposal terms."
  },
  "d056": {
    "sourceHash": "0352f65484f2febeadf2478f4c640adb7fd6be856a8c9efc6b42882ad82bc4e7",
    "description": "Employee healthcare with preventive, outpatient, hospital and emergency services. Variant covering pre-existing conditions, subject to the proposal terms."
  },
  "d094": {
    "sourceHash": "441bf7dd3d73fac79560554a6187a64c16b35604c38198be03242933284a6e1c",
    "description": "Employee healthcare with preventive, outpatient, hospital and emergency services. Standard variant."
  },
  "d095": {
    "sourceHash": "d62c6ecb1d69cb7e1713453f1f6cfbe08e891ac8fb5640508345fd5fa0d953ed",
    "description": "Employee healthcare with preventive, outpatient, hospital and emergency services. Variant covering pre-existing conditions and dreaded diseases, subject to the proposal terms."
  },
  "d096": {
    "sourceHash": "5d6f2741603515f4df86149a25eced5f5ac29a2fdccec181a0923ae13e645e9a",
    "description": "Employee healthcare with preventive, outpatient, hospital and emergency services. Variant covering pre-existing conditions, subject to the proposal terms."
  }
};

export function templateDescription(template: CatalogTemplate) {
  const verified = VERIFIED_DESCRIPTIONS[template.id];
  return verified?.sourceHash === template.sourceHash ? verified.description : `${template.family} · ${template.variant}. Preview this template for its benefits, rates and eligibility.`;
}
