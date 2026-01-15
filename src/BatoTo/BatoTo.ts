import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    DUISection,
    HomePageSectionsProviding,
    HomeSection,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import {
    isLastPage,
    parseChapterDetails,
    parseChapterList,
    parseHomeSections,
    parseMangaDetails,
    parseSearch,
    parseTags,
    parseThumbnailUrl,
    parseViewMore
} from './BatoToParserV4'

import { BTLanguages,
    BTDomains,
    Metadata } from './BatoToHelper'

import { languageSettings,
    domainSettings,
    resetSettings } from './BatoToSettings'

const BATO_DOMAIN_DEFAULT = BTDomains.getDefault()[0] ?? 'https://bato.si'

export const BatoToInfo: SourceInfo = {
    version: '3.1.7',
    // name: 'BatoTo DevDomain 1.0',
    name: 'BatoTo Dev Test 1.5',
    icon: 'icon.png',
    author: 'niclimcy',
    authorWebsite: 'https://github.com/niclimcy',
    description: 'Extension that pulls manga from bato.to',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: BATO_DOMAIN_DEFAULT,
    sourceTags: [
        {
            text: 'Multi Language',
            type: BadgeColor.BLUE
        }
    ],
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS |
        SourceIntents.SETTINGS_UI |
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class BatoTo
implements
        SearchResultsProviding,
        MangaProviding,
        ChapterProviding,
        HomePageSectionsProviding
{
    constructor(private cheerio: CheerioAPI) {}

    stateManager = App.createSourceStateManager();

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 15000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                const selectedDomain = await this.stateManager.retrieve('selected_domain')
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        referer: `${selectedDomain ?? BATO_DOMAIN_DEFAULT}/`,
                        'user-agent':
                    await this.requestManager.getDefaultUserAgent()
                    }
                }
                if (request.url.includes('mangaId=')) {
                    const mangaId = request.url.replace('mangaId=', '')
                    if (mangaId)
                        request.url = await this.getThumbnailUrl(mangaId)
                }
                return request
            },
            interceptResponse: async (
                response: Response
            ): Promise<Response> => {
                console.log(`[BatoTo] ${response.request.url} - ${response.status}`)
                console.log(`[BatoTo-DATA] ${response.data?.toString()}`)
                return response
            }
        }
    })

    async domainRace(path: string, param?: string, isFirstAttempt = true): Promise<{domain: string, domainTime: number, response?: Response }[]> {
        const domains = BTDomains['Domains']
            
        // Try all domains simultaneously with detailed breakdown logging
        const attemptPromises = domains.map(async (domainObj) => {
            const domain: string = domainObj.url
            const domainStart = Date.now()
            //TODO: figure out how to pass cloudflare bypassed domains back to main request function as fallback option
            const cloudflareDomains: string[] = []  
            
            try {
                console.log(`[TESTLOG-DOMAINRACE-TIMING] Starting request to ${domain}`)
                
                const request = App.createRequest({
                    url: `${domain}${!isFirstAttempt ? path : '/'}`,
                    method: 'GET',
                    param: !isFirstAttempt ? param : undefined
                })

                const response = await this.requestManager.schedule(request, 1)
                if (response.status !== 200) {
                    if(response.status == 503 || response.status == 403) {
                        cloudflareDomains.push(domain)
                    }
                    throw new Error(`Request failed with status ${response.status}: ${response.headers}`)
                }
                const domainTime = Date.now() - domainStart

                console.log(`[TESTLOG-DOMAINRACE-TIMING] Domain ${domain} succeeded in ${domainTime}ms with status ${response.status}`)
                
                return isFirstAttempt ? {domain, domainTime} : {domain, domainTime, response}
            } 
            catch (error: any) {
                const domainTime = Date.now() - domainStart
                console.log(`[TESTLOG-DOMAINRACE-TIMING] Domain ${domain} failed after ${domainTime}ms`)

                // Check for specific error types
                switch (true) {
                    case error?.message?.includes('403'):
                    case error?.message?.includes('Cloudflare'):
                        console.log(`[TESTLOG-DOMAINRACE-CLOUDFLARE] ${domain} - Cloudflare challenge detected`)
                        break
                    case error?.message?.includes('timeout'):
                    case error?.message?.includes('timed out'):
                        console.log(`[TESTLOG-DOMAINRACE-TIMEOUT] ${domain} - Request timeout after ${domainTime}ms`)
                        break
                    case error?.message?.includes('ECONNREFUSED'):
                        console.log(`[TESTLOG-DOMAINRACE-CONNECTION] ${domain} - Connection refused`)
                        break
                    case error?.message?.includes('ENOTFOUND'):
                        console.log(`[TESTLOG-DOMAINRACE-DNS] ${domain} - DNS resolution failed`)
                        break
                    default:
                        console.log(`[TESTLOG-DOMAINRACE-ERROR] ${domain} - Error type: ${error?.name || 'Unknown'}`)
                        console.log(`[TESTLOG-DOMAINRACE-ERROR] ${domain} - Error message: ${error?.message || String(error)}`)
                        break
                }

                return {domain, domainTime: -1}
            }
        })

        
        try {
            if (isFirstAttempt) {
                const raceResults = await Promise.all(attemptPromises)
                return raceResults
            }
            const fastestResponse = await Promise.any(attemptPromises)
            return [fastestResponse]
        } catch (aggregateError) {
            console.log('[TESTLOG-DOMAINRACE-ERROR] All mirror domains failed')
            console.log(`[TESTLOG-DOMAINRACE-ERROR] Reasons: ${(aggregateError as AggregateError)?.errors?.map((e: Error) => e.message).join(', ') || 'Unknown'}`)
            throw new Error('All domains failed')
        }
    }

    async networkRequestStatic(path:string, param?:string, data?: any): Promise<Response> {
        const domain = await this.stateManager.retrieve('selected_domain') ?? BATO_DOMAIN_DEFAULT

        try {
            const request = App.createRequest({
                url: `${domain}${path}${param ? param : ''}`,
                method: 'GET',
                data: data ? data : undefined
            })
    
            return await this.requestManager.schedule(request, 1)}
        catch (error: any) {
            throw new Error(`Static domain request failed: ${error?.message || String(error)}`)
        }
    }

    async networkRequestDynamic(path:string, param?:string, data?: any): Promise<Response> {
        // NOTE: temperary disabling race to test other functionalities
        const cachedDomain = await this.stateManager.retrieve('dynamic_domain')
        if (!cachedDomain || cachedDomain === null) {
            let runCount = 0
            let retryAttemptCount = 0
            const retryAttemptMax = 3
            const totalRaceResults: {domain: string, domainTime: number[]}[] = []
            while (runCount < 3) {
                try {
                    const raceResults = await this.domainRace('/')
                    raceResults.forEach(result => {
                        const existing = totalRaceResults.find(r => r.domain === result.domain)
                        if (existing) {
                            existing.domainTime.push(result.domainTime)
                        } else {
                            totalRaceResults.push({domain: result.domain, domainTime:  [result.domainTime]})
                        }
                    })
                    runCount++
                    retryAttemptCount = 0
                } catch (error: any) {
                    // Either all domains failed or some other ***mystical*** error occurred
                    console.log(`[TESTLOG-DOMAINRACE-ERROR] Domain race attempt ${runCount + 1} failed with error: ${error?.message || String(error)}`)
                    if (retryAttemptCount < retryAttemptMax) {
                        console.log(`[TESTLOG-DOMAINRACE-INFO] Retrying domain race attempt ${runCount + 1}`)
                        retryAttemptCount++
                    }
                    break
                }
            }

            if (totalRaceResults.length === 0) {
                // All domains failed during race attempts, no dynamic domain selected.
                throw new Error('All domains failed during race attempts')
            }

            const medianTimes = totalRaceResults.map(result => { return {
                domain: result.domain,
                medianTime: result.domainTime.filter(t => t >= 0).sort((a, b) => a - b)[Math.floor(result.domainTime.filter(t => t >= 0).length / 2)] || Number.MAX_SAFE_INTEGER
            }})
            medianTimes.sort((a, b) => a.medianTime - b.medianTime)
            const bestDomain = medianTimes[0]?.domain
            console.log(`[TESTLOG-NETWORKREQUESTDYNAMIC-INFO] Selected best domain: ${bestDomain} with median time: ${medianTimes[0]?.medianTime}ms`)
            await this.stateManager.store('dynamic_domain', bestDomain)
        }

        const cachedReqStart = Date.now()

        try {
            console.log(`[TESTLOG-NETWORKREQUESTDYNAMIC-TIMING] Starting request to ${cachedDomain}`)
            const request = App.createRequest({
                url: `${cachedDomain}${path}`,
                method: 'GET',
                param: param
            })

            const response = await this.requestManager.schedule(request, 1)
            const cachedReqTime = Date.now() - cachedReqStart
            console.log(`[TESTLOG-NETWORKREQUESTDYNAMIC-TIMING] Stored Domain ${cachedDomain} succeeded after ${cachedReqTime}ms`)
            return response

        } catch (error: any) {
            const cachedReqTime = Date.now() - cachedReqStart
            console.log(`[TESTLOG-NETWORKREQUESTDYNAMIC-TIMING] Stored Domain ${cachedDomain} failed after ${cachedReqTime}ms`)
            console.log(`[TESTLOG-NETWORKREQUESTDYNAMIC-ERROR] ${cachedDomain} - Error type: ${error?.name || 'Unknown'}`)
            console.log(`[TESTLOG-NETWORKREQUESTDYNAMIC-ERROR] ${cachedDomain} - Error message: ${error?.message || String(error)}`)

            try {
                const raceResult = (await this.domainRace(path, param, false))[0]
                console.log(`[TESTLOG-NETWORKREQUESTDYNAMIC-TIMING] New Domain ${raceResult?.domain} succeeded after ${raceResult?.domainTime}ms`)
                await this.stateManager.store('dynamic_domain', raceResult?.domain)
                return raceResult?.response as Response
            } catch (error) {
                throw new Error('All domains failed')
            }

        }
    }

    async networkRequest(path:string, param?:string, data?: any): Promise<Response> {
        const isDynamic = await this.stateManager.retrieve('is_dynamic_domain') ?? false
        if (!isDynamic) {
            await this.stateManager.store(
                'dynamic_domain',
                await this.stateManager.retrieve('selected_domain') ?? BATO_DOMAIN_DEFAULT
            )
            return await this.networkRequestStatic(path, param, data)
        } 
        return await this.networkRequestDynamic(path, param, data)
    }

    async getSourceMenu(): Promise<DUISection> {
        return Promise.resolve(
            App.createDUISection({
                id: 'main',
                header: 'Source Settings',
                isHidden: false,
                rows: async () => [
                    languageSettings(this.stateManager),
                    domainSettings(this.stateManager),
                    resetSettings(this.stateManager)
                ]
            })
        )
    }

    getMangaShareUrl(mangaId: string): string {
        return `${BATO_DOMAIN_DEFAULT}/title/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const tmpDomain = await this.stateManager.retrieve('selected_domain')
        const response = await this.networkRequest(`/title/${mangaId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseMangaDetails($, tmpDomain ?? BATO_DOMAIN_DEFAULT, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const response = await this.networkRequest(`/title/${mangaId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseChapterList($, mangaId)
    }

    async getChapterDetails(
        mangaId: string,
        chapterId: string
    ): Promise<ChapterDetails> {
        const response = await this.networkRequest(`/title/${mangaId}/${chapterId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseChapterDetails($, mangaId, chapterId)
    }

    async getHomePageSections(
        sectionCallback: (section: HomeSection) => void
    ): Promise<void> {
        const tmpDomain = await this.stateManager.retrieve('selected_domain')
        const response = await this.networkRequest('/')
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        parseHomeSections($, tmpDomain ?? BATO_DOMAIN_DEFAULT, sectionCallback)
    }

    async getViewMoreItems(
        homepageSectionId: string,
        metadata: Metadata | undefined
    ): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        let param = ''

        switch (homepageSectionId) {
            case 'popular_updates':
                param = `?sortby=field_score&page=${page}`
                break
            case 'latest_releases':
                param = `?sortby=field_update&page=${page}`
                break
            default:
                throw new Error(
                    'Requested to getViewMoreItems for a section ID which doesn\'t exist'
                )
        }

        const langHomeFilter: boolean =
            (await this.stateManager.retrieve('language_home_filter')) ?? false
        const langs: string[] =
            (await this.stateManager.retrieve('languages')) ??
            BTLanguages.getDefault()
        param += langHomeFilter ? `&langs=${langs.join(',')}` : ''
        const tmpDomain = await this.stateManager.retrieve('selected_domain')

        const response = await this.networkRequest('/comics', param)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        const manga = parseViewMore($, tmpDomain ?? BATO_DOMAIN_DEFAULT)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchResults(
        query: SearchRequest,
        metadata: Metadata | undefined
    ): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1

        let path = `/v4x-search?word=${encodeURI(
            query.title ?? ''
        )}&page=${page}`
        

        const langSearchFilter: boolean =
            (await this.stateManager.retrieve('language_search_filter')) ??
            false
        const langs: string[] =
            (await this.stateManager.retrieve('languages')) ??
            BTLanguages.getDefault()

        let response = await this.networkRequest(path)
        const $ = this.cheerio.load(response.data as string)
        //const scaffold = parseSearch($, langSearchFilter, langs)

        //get search data
        path = '/ap2'
        const data = {
            query: `query get_search_comic($select: Search_Comic_Select) {
                get_search_comic(
                  select: $select
                ) {
                  req_page req_size req_word
                  new_page
                  paging { 
              total pages page init size skip limit prev next
             }
                  items {
                    id data {
                      id dbStatus isPublic name
                      origLang tranLang
                      urlPath urlCover600 urlCoverOri
                      genres altNames authors artists
                      is_hot is_new sfw_result
                      score_val follows reviews comments_total
                      chapterNode_up_to {
                        id data {
                          id dateCreate
                          dbStatus isFinal sfw_result
                          dname urlPath is_new
                          userId userNode {
                            id data {
                              id name uniq avatarUrl urlPath
                            }
                          }
                        }
                      }
                    }
                    sser_follow
                    sser_lastReadChap {
                      date chapterNode {
                        id data {
                          id dbStatus isFinal sfw_result
                          dname urlPath is_new
                          userId userNode {
                            id data {
                              id name uniq avatarUrl urlPath
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }`,
            variables: {
                select: {
                    word: query.title ?? '',
                    sortby: null,
                    page: page,
                    size: 30
                }
            }
        }

        response = await this.networkRequest(path, undefined, data)
        //$ = this.cheerio.load(response.data as string)
        console.log(`[BatoTo-SEARCHDATA] ${response.data?.toString()}`)
        const resData = JSON.parse(response.data ? response.data : '{get_search_comic: {}, items: []}')
        const tmpDomain = await this.stateManager.retrieve('selected_domain')
        const manga = parseSearch(resData.items, langSearchFilter, langs, tmpDomain ?? BATO_DOMAIN_DEFAULT)
        

        resData?.get_search_comic.paging.total === page ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    // async getSearchTags(): Promise<TagSection[]> {
    //     return parseTags()
    // }

    // async getThumbnailUrl(mangaId: string): Promise<string> {
    //     const response = await this.networkRequest(`/title/${mangaId}`)
    //     this.CloudFlareError(response.status)
    //     const $ = this.cheerio.load(response.data as string)
    //     return parseThumbnailUrl($)
    // }

    CloudFlareError(status: number): void {
        if (status == 503 || status == 403) {
            throw new Error(
                `CLOUDFLARE BYPASS ERROR:\nPlease go to the homepage of <${BatoTo.name}> and press the cloud icon.`
            )
        }
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        let tmpDomain: string | string[] | null
        const isDynamic = await this.stateManager.retrieve('is_dynamic_domain') ?? false
        if (!isDynamic) {
            tmpDomain = await this.stateManager.retrieve('selected_domain')
        } else {
            await this.networkRequest('/') // Trigger domain selection and storage
            tmpDomain = await this.stateManager.retrieve('dynamic_domain')

        }
        const domain = tmpDomain ? (typeof tmpDomain === 'string' ? tmpDomain : tmpDomain[0]) : BATO_DOMAIN_DEFAULT

        const req =  App.createRequest({
            url: domain ?? BATO_DOMAIN_DEFAULT,
            method: 'GET',
            headers: {
                referer: `${domain}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })

        console.log(`[BatoTo] Generated Cloudflare bypass request for domain: ${domain}`)
        console.log(`[BatoTo-Request] ${JSON.stringify(req)}`)

        return req
    }
}
