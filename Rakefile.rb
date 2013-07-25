require 'mechanize'
require 'yaml'
require 'json'
require 'open-uri'

namespace :public_registry do
  desc 'Scrape MP disclosures from the Office of the Conflict of Interest and Ethics Commissioner (http://ciec-ccie.gc.ca)'
  task :scrape do |t, args|

    agent = Mechanize.new { |a| a.user_agent_alias = 'Mac Safari' }
    mp_disclosures = {}

    # for each start-of-last-name (A-Z)
    "A".upto("Z") do |l|
      agent.get('http://ciec-ccie.gc.ca/PublicSearchMembers.aspx') do |search_page|
        form = search_page.form('aspnetForm')
        form.field_with(id: 'ctl00_MainContent_txtLastName').value = l
        search_result = form.click_button(form.button_with(value: 'Search'))

        # for each results page
        links = [:this_page] + search_result.links_with(href: /SearchResultsMembers.aspx\?Page/)
        links.each do |result_page_link|
          unless result_page_link == :this_page # already on the first page
            search_result = agent.click result_page_link
          end

          # for each MP
          search_result.links_with(href: /\AViewClientMembers/).each do |link|
            mp_page = link.click
            mp_data = {
                first_name: mp_page.at('#ctl00_MainContent_lblFirstName').parent.next_element.text.strip,
                last_name: mp_page.at('#ctl00_MainContent_lblLastName').parent.next_element.text.strip,
                constituency: mp_page.at('#ctl00_MainContent_lblConstituency').parent.next_element.text.strip,
                review_date: mp_page.at('#ctl00_MainContent_lblAnnualReviewDate').parent.next_element.text.strip
            }

            disclosure_tables = mp_page.parser.css('table').find_all{|t| t['id'] =~ /_panelDeclarationTypeHeader/}.each do |header_table|
              data_table = header_table.next_element

              if header_table.text =~ /Disclosure\s+Summary/
                mp_data[:disclosure_summaries] =
                    data_table.search('tr').map do |tr|
                      next if tr['id'] =~ /SubResultsHeader/

                      doc_link = tr.at('a')
                      disclosure_page =  agent.click(doc_link)

                      investments_node = disclosure_page.at('#ucViewDocument_rowInvestmentResult')
                      liabilities_node = disclosure_page.at('#ucViewDocument_rowLiabilitiesResult')
                      activities_node =  disclosure_page.at('#ucViewDocument_rowActivitiesResult')

                      {
                          status: tr.search('td').find{|td| td['id'] =~ /_cellStatus/}.text.strip,
                          date: doc_link.text.strip,
                          document_url: doc_link['href'],
                          investments: investments_node.nil? ? nil : investments_node.text.split(/\s*[\-\;]\s*/).map{|i| i.strip}.reject{|t| t.empty? },
                          liabilities: liabilities_node.nil? ? nil : liabilities_node.text.split(/\s*[\-\;]\s*/).map{|i| i.strip}.reject{|t| t.empty? },
                          activities: activities_node.nil? ? nil : activities_node.text.split(/\s*[\-\;]\s*/).map{|i| i.strip}.reject{|t| t.empty? }
                      }
                    end.compact

              elsif header_table.text =~ /Gifts\s+or\s+Other\s+Benefits/
                mp_data[:gifts] =
                    data_table.search('tr').map do |tr|
                      next if tr['id'] =~ /SubResultsHeader/

                      doc_link = tr.at('a')
                      gifts_page = agent.click(doc_link)
                      declaration_node = gifts_page.at('#ucViewDocument_pnlDeclarationText')

                      {
                          status: tr.search('td').find{|td| td['id'] =~ /_cellStatus/}.text.strip,
                          date: doc_link.text.strip,
                          document_url: doc_link['href'],
                          declaration: declaration_node.nil? ? nil : declaration_node.text.strip
                      }
                    end.compact
              end
            end

            puts mp_data
            mp_disclosures["#{mp_data[:last_name]} #{mp_data[:first_name]}"] = mp_data
          end
        end
      end
    end

    File.open('./data/mp_disclosures.yaml', 'w') {|f| YAML::dump(mp_disclosures, f) }
  end

  desc 'Mine & format some interesting info from the scraped data'
  task :mine do |t, args|
    data_filename = 'data/mp_disclosures.yaml'
    raise "Scraped data not found under data/mp_disclosures.yaml" unless File.exists? data_filename
    mp_disclosures = YAML.load(File.open(data_filename))

    # flatten data to an array of all disclosures
    flat_disclosures = []
    mp_disclosures.each do |name, mp|
      next if mp[:disclosure_summaries].nil?

      # also get more MP information from represent.opennorth.ca
      try = 0
      success = false
      while !success
        begin
          sleep 1.1 # comply with Represent API rate limits
          puts 'Name: ' + mp[:first_name] + ' ' + mp[:last_name]
          puts "URL: " + "http://represent.opennorth.ca/representatives/?first_name=#{CGI::escape(mp[:first_name])}&last_name=#{CGI::escape(mp[:last_name])}"
          represent_result =
            open("http://represent.opennorth.ca/representatives/?first_name=#{CGI::escape(mp[:first_name])}&last_name=#{CGI::escape(mp[:last_name])}")
          if represent_result.status[0] == "200"
            json_str = represent_result.read
            data = JSON.parse(json_str)['objects']
            mp[:extended_info] = data.first unless data.empty?
            success = true
          end
        rescue => e
          raise e if try >= 3
          try +=1
        end
      end

      # for each disclosure
      mp[:disclosure_summaries].each do |summary|
        unless summary[:investments].nil?
          summary[:investments].each do |investment|
            flat_disclosures << {
             mp: mp,
             disclosure_type: 'investment',
             text: investment,
             date: summary[:date]
             }
          end
        end

        unless summary[:liabilities].nil?
          summary[:liabilities].each do |liability|
            flat_disclosures << {
                mp: mp,
                disclosure_type: 'liability',
                text: liability,
                date: summary[:date]
            }
          end
        end

        unless summary[:activities].nil?
          summary[:activities].each do |activity|
            flat_disclosures << {
              mp: mp,
              disclosure_type: 'activity',
              text: activity,
              date: summary[:date]
            }
          end
        end
      end

      unless mp[:gifts].nil?
        mp[:gifts].each do |gift|
          flat_disclosures << {
            mp: mp,
            disclosure_type: 'gift',
            text: gift[:declaration],
            date: gift[:date]
          }
        end
      end
    end

    # rudimentary text processing to find mentions of companies and organizations (basic tokenization followed by a search
    # for proper nouns on the basis of capitalized words and abbreviations)
    org_index = {}
    chunk = []
    flat_disclosures.each do |d|
      clauses = d[:text].split(/[,;]/)
      clauses.each do |clause|
        text = clause + " end"
        text.scan(/[A-Za-z\d\.]+/) do |word|
          word.chomp!(".")
          if ((word[0] =~ /[A-Z]/) || (word =~ /\A\d+\Z/) || (chunk.length > 0 && (['of','and'].include?(word)))) &&
             !["Owner","CEO","President","Chair","Board","Member","Trustee","Trustees","Director","Directors",
               "Chairman","Officer","Secretary","Treasurer"].include?(word)
            chunk << word
          else
            if !chunk.empty?
              # consider completed chunk a proper noun if it's either a periodless abbreviation (with 0 or more capitalized
              # words after) or two or more consecutive capitalized words (most companies names have a trailing Ltd or Inc)
              if ((chunk.length >= 2 || (chunk.first =~ /\A[A-Z\.]+\Z/)) && (!['of','and'].include?(chunk.last))) &&
                 !(chunk.length == 1 && chunk.first.length == 1)
                org = chunk.join(" ")
                org_index[org] = [] if org_index[org].nil?
                org_index[org] << d
              end
            end
            chunk = []
          end
        end
      end
    end

    result = {
      organizations: org_index.map do |k,v|
        {
          id: k,
          type: 'organization',
          children: v.map do |d|
            {
                id: "#{d[:mp][:first_name]} #{d[:mp][:last_name]}",
                type: 'mp',
                constituency: d[:mp][:constituency],
                party: (d[:mp][:extended_info].nil? ? "unknown" : d[:mp][:extended_info]['party_name'].downcase),
                disclosure_text: "#{d[:text]} (#{d[:date]})",
                disclosure_type: d[:disclosure_type]
            }
          end
        }
      end
    }

    File.open('./data/processed_data.yaml', 'w') {|f| YAML::dump(result, f) }
    File.open('./www/processed_data.json', 'w') {|f| f.write JSON.generate(result) }
  end
end