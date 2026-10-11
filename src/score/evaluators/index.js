// Every evaluator by name, as the catalog's `evaluator:` field refers to it.
import { kubeEvaluators, kubeEvaluatorsMore } from "./kube.js";

export const EVALUATORS = { ...kubeEvaluators, ...kubeEvaluatorsMore };
