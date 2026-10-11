// Every evaluator by name, as the catalog's `evaluator:` field refers to it.
import { awsEvaluators } from "./aws.js";
import { kubeEvaluators, kubeEvaluatorsMore } from "./kube.js";

export const EVALUATORS = { ...kubeEvaluators, ...kubeEvaluatorsMore, ...awsEvaluators };
