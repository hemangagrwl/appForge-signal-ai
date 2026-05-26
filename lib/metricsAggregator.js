class MetricsAggregator {

    constructor(){

        this.runs=[];
    }

    addRun(run){

        this.runs.push(run);
    }

    getSummary(){

        const total=this.runs.length;

        if(total===0){

            return{
                successRate:0,
                avgRetries:0,
                avgLatency:0,
                failureBreakdown:{}
            };
        }

        const successful=
            this.runs.filter(
                r=>r.success
            );

        const totalRetries=
            this.runs.reduce(
                (sum,r)=>sum+(r.retries||0),
                0
            );

        const totalLatency=
            this.runs.reduce(
                (sum,r)=>sum+(r.latency||0),
                0
            );

        const failureBreakdown={};

        this.runs
            .filter(r=>!r.success)
            .forEach(run=>{

                const type=
                    run.failureType || "unknown";

                failureBreakdown[type]=
                    (failureBreakdown[type]||0)+1;
            });

        return{

            successRate:
                successful.length/total,

            avgRetries:
                totalRetries/total,

            avgLatency:
                totalLatency/total,

            failureBreakdown
        };
    }
}

export default MetricsAggregator;