
import jwt from 'jsonwebtoken'
function verifyToken(req,res,next){
    const authUser=req.headers.authorization
    if(!authUser){
        res.status(400).send({message:"invalid token"});
        return
    }
    const tok=authUser.split(" ")[1];
    try{
    const decode=jwt.verify(tok,process.env.USER_TOKEN)
    req.userData=decode.emailid;
    next()
    }catch(err){
       return res.status(401).send({message:"Unauthorized user",error:true,success:false})
    }
}

export default verifyToken