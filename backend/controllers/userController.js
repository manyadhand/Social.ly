import { sendEMail } from "../middleware/sendMail.js"
import User from "../models/userModel.js"
import { Response } from "../utils/response.js"
import { message } from "../utils/message.js"
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let emailTemplate = fs.readFileSync(path.join(__dirname, '../templates/mail.html'), 'utf-8');

export const registerUser = async (req, res) => {
    try {
        // Parsing body data
        const { firstName, middleName, lastName, email, password, dob, mobile, bio, username, gender } = req.body

        // Checking the body data
        if(!firstName || !lastName || !email || !password || !dob || !mobile || !username || !gender) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            })
        }

        // If user exists
        let user = await User.findOne({ email })
        if(user) {
            return res.status(400).json({
                success: false,
                message: 'User already exists'
            })
        }

        user = await User.findOne({ username })
        if(user) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists'
            })
        }

        // Create user

        user = await User.create({...req.body});

        const otp = Math.floor(100000 + Math.random() * 90000);
        const otpExpire = new Date(Date.now() + 15 * 60 * 1000);

        user.otp = otp;
        user.otpExpire = otpExpire;
        await user.save();

        // Email generation
        const subject = "Verify your account";
        const body = `Your OTP is ${otp}`;
        emailTemplate = emailTemplate.replace('{{OTP_CODE}}', otp);
        emailTemplate = emailTemplate.replaceAll('{{MAIL}}', process.env.SMTP_USER);
        emailTemplate = emailTemplate.replace('{{PORT}}', process.env.PORT);
        emailTemplate = emailTemplate.replace('{{USER_ID}}', user._id.toString());
        // emailTemplate = emailTemplate.replace('{{MAIL}}', process.env.SMTP_USER);
        await sendEMail({
            email: user.email, 
            subject, 
            message: body,
            html: emailTemplate
        });

        // Send response
        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: user
        })
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        })
        // Responses(res, 500, false, error.message);
    }
}

export const verifyUser = async (req, res) => {
    try {
        // params and body
        const { id } = req.params;
        let { otp } = req.body;

        // Check id
        if(!id) {
            return Response(res, 400, false, message.idNotFoundMessage);
        }

        // Find user
        let user = await User.findById(id);
        if(!user) {
            return Response(res, 404, false, message.userNotFoundMessage);
        }

        // Check if user is already verified
        if(user.verified) {
            user.otp = undefined;
            user.otpExpire = undefined;
            user.otpAttempts = 0;
            user.otpAttemptsExpire = undefined;
            await user.save();

            return Response(res, 400, false, message.userAlreadyVerifiedMessage);
        }

        // Check if otpAttemptsExpire
        if(user.otpAttemptsExpire > Date.now()) {
            user.otp = undefined;
            user.otpExpire = undefined;
            user.otpAttempts = 0;
            await user.save();

            return Response(res, 400, false, `Try again after ${Math.floor((user.otpAttemptsExpire - Date.now()) % (60* 1000))} minutes and ${(user.otpAttemptsExpire - Date.now()) % 60} seconds`);
        }

        // Check if otp attempts
        if(user.otpAttempts >= 3) {
            user.otp = undefined;
            user.otpExpire = undefined;
            user.otpAttempts = 0;
            user.otpAttemptsExpire = new Date(Date.now() + process.env.OTP_ATTEMPTS_EXPIRE * 60 * 1000);
            await user.save();

            return Response(res, 400, false, message.otpAttemptsExceededMessage);
        }

        // Check if otp exists
        if(!otp) {
            user.otpAttempts += 1;
            await user.save();

            return Response(res, 400, false, message.otpNotFoundMessage);
        }

        // Check if otp is expired
        if(user.otpExpire < Date.now()) {
            user.otp = undefined;
            user.otpAttempts = 0;
            user.otpAttemptsExpire = undefined;
            await user.save();
            
            return Response(res, 400, false, message.otpExpiredMessage);
        }

        // If otp matches
        otp = Number(otp);
        if(user.otp !== otp) {
            user.otpAttempts += 1;
            await user.save();

            return Response(res, 401, false, message.invalidOtpMessage)
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpire = undefined;
        user.otpAttempts = 0;
        user.otpAttemptsExpire = undefined;
        await user.save();

        // Authenticate user
        const token = user.generateToken();

        const options = {
            expires: new Date(Date.now() + process.env.COOKIE_EXPIRE * 24 * 60 * 60 * 1000),
            httpOnly: true,
            sameSite: 'none',
            secure: true
        }

        res.status(200).cookie('token', token, options).json({
            success: true,
            message: message.userVerifiedMessage,
            data: user
        });
        

    } catch (error) {
        Response(res, 500, false, error.message);
    }
}

export const resendOtp = async (req, res) => {
    try {
        // params and body
        const { id } = req.params;

        // Check id
        if(!id) {
            return Response(res, 400, false, message.idNotFoundMessage);
        }

        // Find user & check user
        let user = await User.findById(id);
        if(!user) {
            return Response(res, 404, false, message.userNotFoundMessage);
        }

        // Check if user is already verified
        if(user.verified) {
            user.otp = undefined;
            user.otpExpire = undefined;
            user.otpAttempts = 0;
            user.otpAttemptsExpire = undefined;
            await user.save();

            return Response(res, 400, false, message.userAlreadyVerifiedMessage);
        }

        // Generate new otp
        const otp = Math.floor(100000 + Math.random() * 900000);
        const otpExpire = new Date(Date.now() + process.env.OTP_EXPIRE * 60 * 1000);
        
        // Save otp
        user.otp = otp;
        user.otpExpire = otpExpire;
        user.otpAttempts = 0;
        user.otpAttemptsExpire = undefined;
        await user.save();

        // Send otp
        const subject = "Verify your account";
        const body = `Your OTP is ${otp}`;
        emailTemplate = emailTemplate.replace('{{OTP_CODE}}', otp);
        emailTemplate = emailTemplate.replaceAll('{{MAIL}}', process.env.SMTP_USER);
        emailTemplate = emailTemplate.replace('{{PORT}}', process.env.PORT);
        emailTemplate = emailTemplate.replace('{{USER_ID}}', user._id.toString());
        // emailTemplate = emailTemplate.replace('{{MAIL}}', process.env.SMTP_USER);
        await sendEMail({
            email: user.email, 
            subject, 
            message: body,
            html: emailTemplate
        });

        // Send response
        // console.log(message.otpSendMessage);
        Response(res, 200, true, message.otpSendMessage);
        
    } catch (error) {
        Response(res, 500, false, error.message);
    }
}

export const loginUser = async (req, res) => {
    try {
        // Parsing body data
        const { email, password } = req.body

        // Checking body data
        if(!email || !password) {
            return Response(res, 400, false, message.missingFieldsMessage);
        }

        // Find user
        let user = await User.findOne({ email }).select('+password');

        // Check user
        if(!user) {
            return Response(res, 404, false, message.userNotFoundMessage);
        }

        // If login attempt is locked
        if(user.lockUntil < Date.now()) {
            user.loginAttempts = 0;
            user.loginOtp = undefined;
            await user.save();

            return Response(res, 400, false, message.loginLockedMessage);
        }

        // If login attempts exceeded
        if(user.loginAttempts >= process.env.MAX_LOGIN_ATTEMPTS) {
            user.loginAttempts = 0;
            user.loginOtp = undefined;
            user.lockUntil = new Date(Date.now() + process.env.MAX_LOGIN_ATTEMPTS_EXPIRE * 60 * 1000);
            await user.save();

            return Response(res, 400, false, message.loginLockedMessage);
        }

        // Check password
        const isMatch = await user.matchPassword(password);
        if(!isMatch) {
            user.loginAttempts += 1;
            await user.save();
            return Response(res, 400, false, message.badAuthMessage);
        }

        // Generate otp
        const loginOtp = Math.floor(100000 + Math.random() * 900000);
        const loginOtpExpire = new Date(Date.now() + process.env.LOGIN_OTP_EXPIRE * 60 * 1000);

        // Send otp
        const subject = "Verify your account";
        // const body = `Your OTP is ${otp}`;

        emailTemplate = emailTemplate.replace('{{OTP_CODE}}', loginOtp);
        emailTemplate = emailTemplate.replaceAll('{{MAIL}}', process.env.SMTP_USER);
        emailTemplate = emailTemplate.replace('{{PORT}}', process.env.PORT);
        emailTemplate = emailTemplate.replace('{{USER_ID}}', user._id.toString());

        await sendEMail({
            email, 
            subject, 
            html: emailTemplate,
        })

        // Update user with otp
        user.loginOtp = loginOtp;
        user.loginOtpExpire = loginOtpExpire;
        user.loginAttempts = 0;
        user.lockUntil = undefined

        await user.save();

        // Send response
        // Response(res, 200, true, message.otpSendMessage)
        res.render("otp", {
            id: user._id,
        });

        
    } catch (error) {
        
    }
}

export const verifyLoginOtp = async (req, res) => {
    try {
        console.log("W1")
        // params and body
        const { id } = req.params;
        let { otp } = req.body;

        // Check id
        if(!id) {
            return Response(res, 400, false, message.idNotFoundMessage);
        }

        // Find & check user
        let user = await User.findById(id);
        if(!user) {
            return Response(res, 404, false, message.userNotFoundMessage);
        }

        // console.log("User: ", user)
        // If user is not verified
        if(!user.isVerified) {
            return Response(res, 400, false, message.userNotVerifiedMessage);
        }

        // if Login otp attempts locked
        if(user?.loginOtpAttemptsExpire > Date.now()) {
            return Response(res, 400, false, message.loginLockedMessage);
        }

        // If login attempts exceeded
        if(user?.loginOtpAttempts >= process.env.MAX_LOGIN_ATTEMPTS) {
            return Response(res, 400, false, message.otpAttemptsExceededMessage);
        }

        // Check otp
        if(!otp) {
            return Response(res, 400, false, message.otpNotFoundMessage);
        }

        // Check if otp is expired
        // console.log("Otp Time: ", user.loginOtpExpire)
        // console.log("Curr Time: ", Date.now())
        if(user?.loginOtpExpire < Date.now()) {
            return Response(res, 400, false, message.otpExpiredMessage);
        }

        // Check if otp is correct
        console.log(typeof user?.loginOtp, typeof otp)
        if(user?.loginOtp != otp) {
            return Response(res, 400, false, message.invalidOtpMessage);
        }

        // Update user
        user.loginOtp = undefined;
        user.loginOtpExpire = undefined;
        user.loginOtpAttempts = 0;
        user.loginOtpAttemptsExpire = undefined;
        await user.save();

        // Authenticate user
        const token = await user.generateToken();

        const options = {
            expires: new Date(Date.now() + process.env.COOKIE_EXPIRE * 24 * 60 * 60 * 1000),
            httpOnly: true,
            sameSite: 'none',
            secure: true
        }

        res.status(200).cookie('token', token, options).json({
            success: true,
            message: message.loginSuccessfulMessage,
            data: user,
        })
        
    } catch (error) {
        Response(res, 500, false, error.message);
    }
}

export const resendLoginOtp = async (req, res) => {
    try {
        // params and body
        const { id } = req.params;

        // Check id
        if(!id) {
            return Response(res, 400, false, message.idNotFoundMessage);
        }

        // Find user & check user
        let user = await User.findById(id);
        if(!user) {
            return Response(res, 404, false, message.userNotFoundMessage);
        }

        // If user is not verified
        if(!user.verified) {
            return Response(res, 400, false, message.userNotVerifiedMessage);
        }

        // Generate new otp
        const otp = Math.floor(100000 + Math.random() * 900000);
        const otpExpire = new Date(Date.now() + process.env.OTP_EXPIRE * 60 * 1000);
        
        // Save otp
        user.loginOtp = otp;
        user.loginOtpExpire = otpExpire;
        user.loginOtpAttempts = 0;
        user.loginOtpAttemptsExpire = undefined;
        await user.save();

        // Send otp
        const subject = "Verify your account";
        const body = `Your OTP is ${otp}`;
        emailTemplate = emailTemplate.replace('{{OTP_CODE}}', otp);
        emailTemplate = emailTemplate.replaceAll('{{MAIL}}', process.env.SMTP_USER);
        emailTemplate = emailTemplate.replace('{{PORT}}', process.env.PORT);
        emailTemplate = emailTemplate.replace('{{USER_ID}}', user._id.toString());
        await sendEMail({
            email: user.email, 
            subject, 
            message: body,
            html: emailTemplate
        });

        // Send response
        Response(res, 200, true, message.otpSendMessage);
        
    } catch (error) {
        Response(res, 500, false, error.message);
    }
}

export const logoutUser = async (req, res) => {
    try {
        res.cookie('token', null, {
            expires: new Date(Date.now()),
            httpOnly: true,
            sameSite: 'none',
            secure: true
        })

        Response(res, 200, true, message.logoutMessage);

    } catch (error) {
        Response(res, 500, false, error.message);
    }
}

export const myProfile = async (req, res) => {
    try {

        if(!req.user) {
            return Response(res, 404, false, message.userNotFoundMessage);
        }

        Response(res, 200, true, message.userProfileFoundMessage, req.user);
        
    } catch (error) {
        Response(res, 500, false, error.message);
    }
}

export const updateUser = async (req, res) => {
    try {

        if(!req.user) {
            return Response(res, 404, false, message.userNotFoundMessage);
        }

        const user = await User.findByIdAndUpdate(req.user._id, req.body, {
            new: true,
            runValidators: true,
            timestamps: true,
            upsert: true
        });

        Response(res, 200, true, message.userProfileUpdatedMessage, user);
        
    } catch (error) {
        Response(res, 500, false, error.message);
    }
}