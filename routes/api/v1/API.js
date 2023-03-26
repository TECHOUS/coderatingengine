const express = require('express')
const router = express.Router()
const {
    getCodeBaseFilesCount,
    generateDocumentIndex,
    getCodeBaseFilesArray,
    callGithubApiToGetFileContent,
    rateCodeAndUpdate,
    getCodeBaseFileForUser,
    generateAndSaveToken,
    getCodeBaseFilesRating,
} = require('../../../src/engine')
const {
    checkRandomCodesCacheExpiry,
    getRandomCodesFromCache,
    setRandomCodesInCache,
    checkSearchUserCacheExpiry,
    getSearchUserFromCache,
    setSearchUserInCache,
} = require('../../../src/cache')
// import middlewares
const {authenticateAPI} = require('../../../src/auth')
const {updateValidator, searchValidator} = require('../../../src/validator')

/**
 * @endpoint /api/v1/randomCodes
 * @description api get the randomCodes present in code base
 * @copyright TECHOUS
 * @since 28 June 2021
 * @url http://localhost:5000/api/v1/randomCodes
 * @method GET
 * @access public
 * @author gaurav
 * @return
 * {
 *      status: 200,
 *      codeObject1: {},
 *      codeObject2: {},
 *      accessToken: __
 * }
 **/
router.get('/randomCodes', async (req, res) => {
    // return the cache data if present
    if (checkRandomCodesCacheExpiry()) {
        return res.status(200).json(getRandomCodesFromCache())
    }

    const count = await getCodeBaseFilesCount()
    if (count > 0) {
        // generate and save the token to store
        const {token} = await generateAndSaveToken()
        let index1 = generateDocumentIndex(count, -1)
        let index2 = generateDocumentIndex(count, index1)
        let fileDocuments = await getCodeBaseFilesArray()
        let content1 = await callGithubApiToGetFileContent(
            fileDocuments[index1].codeUrl
        )
        let content2 = await callGithubApiToGetFileContent(
            fileDocuments[index2].codeUrl
        )

        // remove the author from the contents due to security
        content1 = content1.data.replace(
            content1.data.substring(
                content1.data.indexOf('AUTHOR:'),
                content1.data.indexOf('\n', content1.data.indexOf('AUTHOR:'))
            ),
            ''
        )
        content2 = content2.data.replace(
            content2.data.substring(
                content2.data.indexOf('AUTHOR:'),
                content2.data.indexOf('\n', content2.data.indexOf('AUTHOR:'))
            ),
            ''
        )

        // setting the cache data with time
        setRandomCodesInCache({
            time: Date.now(),
            data: {
                status: 200,
                codeObject1: {
                    codeId: fileDocuments[index1].codeId,
                    codeRating: fileDocuments[index1].codeRating,
                    codeUrl: fileDocuments[index1].codeUrl,
                    codeName: fileDocuments[index1].codeName,
                    content: content1,
                },
                codeObject2: {
                    codeId: fileDocuments[index2].codeId,
                    codeRating: fileDocuments[index2].codeRating,
                    codeUrl: fileDocuments[index2].codeUrl,
                    codeName: fileDocuments[index2].codeName,
                    content: content2,
                },
                accessToken: token,
            },
        })

        res.status(200).json(getRandomCodesFromCache())
    } else {
        res.status(404).json({
            status: 404,
            message: 'Not Found',
        })
    }
})

/**
 * @endpoint /api/v1/rateCode
 * @description API to generate the rating for the winner and update
 * @copyright TECHOUS
 * @since 4 July 2021
 * @method PUT
 * @access private
 *
 * @author gaurav
 * @return
 * {
 *      "update1":{},
 *      "update2":{},
 *      "status": 200,
 *      "message": ""
 * }
 **/
router.put('/rateCode', authenticateAPI, updateValidator, async (req, res) => {
    const {codeId1, codeId2, winner} = req.body

    const codeBaseFiles = await getCodeBaseFilesRating(codeId1, codeId2)
    let codeRating1 = 0
    let codeRating2 = 0
    codeBaseFiles.map((codeBaseFile) => {
        if (codeBaseFile.codeId === codeId1) {
            codeRating1 = codeBaseFile.codeRating
        } else if (codeBaseFile.codeId === codeId2) {
            codeRating2 = codeBaseFile.codeRating
        }
    })
    const updateResult = await rateCodeAndUpdate({
        codeId1,
        codeId2,
        codeRating1,
        codeRating2,
        winner,
    }).catch((err) => {
        return res.status(400).json({
            status: 400,
            message: 'Bad Request!!!',
        })
    })

    updateResult.status = 200
    updateResult.message = 'Code Ratings are updated'
    res.status(200).json(updateResult)
})

/**
 * @endpoint /api/v1/searchUser?username=__
 * @description search and return the code rating for the specific user
 * @copyright TECHOUS
 * @since 4 July 2021
 * @method GET
 * @access private
 *
 * @param username
 * @param sendContent
 *
 * @author gaurav
 * @return
 * {
 *      status: 200,
 *      userCodeBaseFiles: []
 * }
 **/
router.get(
    '/searchUser',
    authenticateAPI,
    searchValidator,
    async (req, res) => {
        const {username, sendContent} = req.query

        // send the cache data according to username and sendContent
        if (checkSearchUserCacheExpiry(username, sendContent)) {
            return res.status(200).json(getSearchUserFromCache())
        }

        let userCodeBaseFiles = await getCodeBaseFileForUser(username).catch(
            (err) =>
                res.status(500).json({
                    status: 500,
                    err,
                    message: 'Internal Server Error',
                })
        )
        if (userCodeBaseFiles.length <= 0) {
            res.status(404).json({
                status: 404,
                message: 'No Code Base file found for the respective user',
            })
        } else if (sendContent === 'true') {
            userCodeBaseFiles = userCodeBaseFiles.map(async (fileObj) => {
                const content = await callGithubApiToGetFileContent(
                    fileObj._doc.codeUrl
                )
                const newFileObject = {
                    ...fileObj._doc,
                    content: content.data,
                }
                return newFileObject
            })
            Promise.all(userCodeBaseFiles).then((data) => {
                // setting the cache
                setSearchUserInCache({
                    data: {
                        status: 200,
                        userCodeBaseFiles: data,
                    },
                    time: Date.now(),
                    username,
                    sendContent,
                })
                res.status(200).json(getSearchUserFromCache())
            })
        } else {
            setSearchUserInCache({
                data: {
                    status: 200,
                    userCodeBaseFiles,
                },
                time: Date.now(),
                username,
                sendContent,
            })
            res.status(200).json(getSearchUserFromCache())
        }
    }
)

module.exports = router