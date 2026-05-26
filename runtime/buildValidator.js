import { execSync } from "child_process";

class BuildValidator {

    run(command){

        try{

            execSync(command,{
                stdio:"pipe"
            });

            return{
                passed:true,
                details:"Success"
            };
        }

        catch(error){

            return{
                passed:false,
                details:error.message
            };
        }
    }

    validate(){

        const checks=[];

        checks.push({
            name:"Node syntax validation",
            ...this.run(
                "node --check server.js"
            )
        });

        checks.push({
    name:"Node syntax validation",
    ...this.run(
        "node --check server.js"
    )
    });

        return checks;
    }
}

export default BuildValidator;