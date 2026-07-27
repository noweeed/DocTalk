
const planLimits = {
  free: { maxDocuments: 5, maxQuestionsPerMonth: 50, model: "standard" },
  pro: {
    maxDocuments: Infinity,
    maxQuestionsPerMonth: Infinity,
    model: "priority",
  },
};

module.exports = planLimits;
