class ModelMetrics {

    constructor(){

        this.runs=[];
    }

    addRun(data){

        this.runs.push(data);
    }

    summary(){

        if(this.runs.length===0){

            return {};
        }

        const totalCost =
            this.runs.reduce(
                (s,r)=>s+r.cost,
                0
            );

        const totalLatency =
            this.runs.reduce(
                (s,r)=>s+r.latency,
                0
            );

        const totalQuality =
            this.runs.reduce(
                (s,r)=>s+r.quality,
                0
            );

        return{

            requests:
                this.runs.length,

            avgCost:
                totalCost/this.runs.length,

            avgLatency:
                totalLatency/this.runs.length,

            avgQuality:
                totalQuality/this.runs.length
        };
    }
}

export default ModelMetrics;