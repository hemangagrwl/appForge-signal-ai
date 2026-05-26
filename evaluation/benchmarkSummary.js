class BenchmarkSummary {

    constructor(){

        this.results=[];
    }

    add(result){

        this.results.push(result);
    }

    generate(){

        const total=
            this.results.length;

        const successful=
            this.results.filter(
                r=>r.success
            );

        const failures={};

        this.results.forEach(result=>{

            if(!result.success){

                const type=
                    result.failureType ||
                    "unknown";

                failures[type]=
                    (failures[type]||0)+1;
            }
        });

        const avgRetries=
            this.results.reduce(
                (s,r)=>s+(r.retries||0),
                0
            )/total;

        const avgLatency=
            this.results.reduce(
                (s,r)=>s+(r.latency||0),
                0
            )/total;

        return{

            successRate:
                successful.length/total,

            avgRetries,

            avgLatency,

            failureBreakdown:
                failures
        };
    }
}

export default BenchmarkSummary;