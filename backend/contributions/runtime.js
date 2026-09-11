const { ContributionService } = require('./service');
const { ReviewWorker } = require('./worker');
const service = new ContributionService({ db: require('../db') });
const worker = new ReviewWorker(service);
const candidates = new (require('./candidates').CandidateService)(service);
const distribution = new (require('./distribution').ContributorDistribution)(service);
const releases = new (require('./releases').ReleaseService)(service, candidates);
if (service.config.read().workerEnabled && process.env.SF_REVIEW_WORKER_AUTOSTART !== '0') worker.start();
module.exports = { service, worker, candidates, distribution, releases };
